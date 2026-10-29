import { createHash } from "node:crypto";

/**
 * Puller ERP — satu-satunya tempat yang bicara ke API ERP.
 *
 * Dipakai dua konsumen:
 *   1) scripts/erp-sync.mjs   → membangun snapshot di `.data/erp/`
 *   2) lib/erp/client.ts      → mode live (`OSR_CATALOG_SOURCE=live`)
 *
 * Sengaja ditulis JavaScript murni (bukan TS) supaya bisa di-import langsung
 * oleh skrip Node tanpa langkah build.
 */

/** ERP OSR — `Nosdovah/BPI-Simulation-ERP` (bukan MOAI SCM-ERP). */
export const DEFAULT_BASE_URL = "http://127.0.0.1:8100";

/**
 * User-Agent browser wajib. Sebagian WAF/edge menolak UA non-browser
 * (mis. `node` atau `Python-urllib`) dengan 401 walau token valid.
 */
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const ERP_ENDPOINTS = {
  products: "/api/v2/master/products?limit=5000",
  balances: "/api/v2/inventory/balances?limit=5000",
  boms: "/api/v2/assembly/boms",
  warehouses: "/api/v2/master/warehouses",
  operational: "/api/v2/master/operational",
  /**
   * Satu-satunya tempat angka phantom bisa dibaca langsung:
   * phantom = quota_static − stock_from_components.
   *
   * Sebelum ini endpoint TIDAK ditarik, sehingga webstore tidak pernah tahu ada
   * phantom stock — persis cacat yang diukur paper (10.932 vs 9.937 = 995 unit).
   * Kalau endpoint ini mati, `bundle_stock_available=false` dan gate phantom
   * dilewati dengan catatan — bukan diam-diam dianggap nol.
   */
  bundleStock: "/api/v2/assembly/bundle-stock",
};

export function resolveErpConfig(env = process.env) {
  return {
    baseUrl: (env.OSR_ERP_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    token: env.OSR_ERP_TOKEN || "",
    timeoutMs: Math.max(1000, Number(env.OSR_ERP_TIMEOUT_MS || 20000)),
    retries: Math.max(0, Number(env.OSR_ERP_RETRIES ?? 2)),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(cfg, path) {
  const url = `${cfg.baseUrl}${path}`;
  let lastErr = null;

  for (let attempt = 0; attempt <= cfg.retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "application/json",
          ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });

      if (res.status === 401 || res.status === 403) {
        const err = new Error(
          `ERP menolak request (${res.status}) pada ${path}. ` +
            `Isi OSR_ERP_TOKEN dengan token service ERP (bukan token demo) lalu ulangi.`,
        );
        err.fatal = true;
        throw err;
      }
      if (!res.ok) {
        throw new Error(`ERP ${res.status} ${res.statusText} pada ${path}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err && err.fatal) break;
      if (attempt < cfg.retries) await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function asArray(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  return [];
}

/**
 * ERP memakai dua nama kunci untuk hal yang sama: `bundle_stock` (fixture/spec)
 * dan `bundles` (implementasi v2). Menerima keduanya lebih murah daripada
 * memilih salah satu lalu kehilangan data tanpa error.
 */
function firstArray(payload, ...keys) {
  for (const key of keys) {
    const arr = asArray(payload, key);
    if (arr.length > 0) return arr;
  }
  return [];
}

/**
 * Fetch yang boleh gagal. Dipakai HANYA untuk endpoint pelengkap: kalau
 * `bundle-stock` belum ada (mis. schema v2 belum ter-deploy), pull tetap jalan
 * dan kegagalannya tercatat — bukan menggagalkan seluruh sinkronisasi, dan
 * bukan pula dianggap "tidak ada phantom".
 */
async function getJsonOptional(cfg, path) {
  try {
    return { ok: true, payload: await getJson(cfg, path) };
  } catch (err) {
    if (err && err.fatal) throw err;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Pemeriksaan konsistensi referensial — dipakai sebagai gate sebelum snapshot ditulis. */
export function checkIntegrity(data) {
  const skus = new Set(data.products.map((p) => p.sku));
  const seen = new Set();
  const duplicateSkus = [];
  for (const p of data.products) {
    if (seen.has(p.sku)) duplicateSkus.push(p.sku);
    seen.add(p.sku);
  }

  const orphanBoms = [];
  for (const bom of data.boms) {
    const missingTarget = !skus.has(bom.target_sku);
    const missingComponents = (bom.components || [])
      .map((c) => c.component_sku)
      .filter((sku) => !skus.has(sku));
    if (missingTarget || missingComponents.length > 0) {
      orphanBoms.push({
        target_sku: bom.target_sku,
        missing_target: missingTarget,
        missing_components: missingComponents,
      });
    }
  }

  const missingPrice = data.products
    .filter((p) => !Number.isFinite(Number(p.unit_price)) || Number(p.unit_price) <= 0)
    .map((p) => p.sku);

  const negativeStock = data.balances
    .filter((b) => Number(b.stock_on_hand) < 0)
    .map((b) => b.sku);

  // Phantom: kuota statis bundle melebihi kapasitas komponennya.
  // null = tidak bisa dihitung (BOM kosong) → dilaporkan terpisah, bukan 0.
  const bundleStock = Array.isArray(data.bundle_stock) ? data.bundle_stock : [];
  const phantomBundles = [];
  const unknownBundles = [];
  for (const b of bundleStock) {
    const quota = Number(b.quota_static);
    const raw = b.stock_from_components;
    const fromComponents = raw === null || raw === undefined ? null : Number(raw);
    if (!Number.isFinite(quota)) continue;
    if (fromComponents === null || !Number.isFinite(fromComponents)) {
      unknownBundles.push(b.bundle_sku);
      continue;
    }
    const phantom = Math.max(0, quota - fromComponents);
    if (phantom > 0) {
      phantomBundles.push({
        bundle_sku: b.bundle_sku,
        quota_static: quota,
        stock_from_components: fromComponents,
        phantom_units: phantom,
      });
    }
  }

  // ---- BOM coverage & kapasitas terhitung --------------------------
  // Diperlukan karena pada mode to-be ERP BERHENTI menerbitkan kuota statis
  // (bundle_quota_manual kosong). Tanpa blok ini, `bundle_stock` kosong akan
  // terbaca sebagai "aman", padahal artinya "kuota tidak lagi dipakai —
  // kapasitas harus dihitung dari komponen".
  const isBundle = (p) =>
    p.is_bundle === true || String(p.item_type || "").toUpperCase() === "BUNDLE";
  const bundleSkus = data.products.filter(isBundle).map((p) => p.sku);
  const bomTargets = new Set(data.boms.map((b) => b.target_sku));
  const bundlesWithoutBom = bundleSkus.filter((sku) => !bomTargets.has(sku));

  const available = new Map();
  for (const b of data.balances) {
    const qty = Number(b.available ?? b.stock_on_hand ?? 0);
    available.set(b.sku, (available.get(b.sku) ?? 0) + (Number.isFinite(qty) ? qty : 0));
  }

  const bundleCapacity = {};
  for (const bom of data.boms) {
    let min = null;
    for (const c of bom.components || []) {
      const qty = Math.max(1, Number(c.qty ?? c.multiplier_qty ?? 1));
      const stock = available.get(c.component_sku) ?? 0;
      const units = Math.floor(stock / qty);
      min = min === null ? units : Math.min(min, units);
    }
    bundleCapacity[bom.target_sku] = min;
  }

  // Kuota statis yang masih ada (baseline) dibandingkan dengan kapasitas nyata.
  for (const [sku, cap] of Object.entries(bundleCapacity)) {
    if (cap === null) continue;
    const quotaRow = bundleStock.find((b) => b.bundle_sku === sku);
    if (quotaRow && Number.isFinite(Number(quotaRow.quota_static))) {
      const phantom = Math.max(0, Number(quotaRow.quota_static) - cap);
      if (phantom > 0 && !phantomBundles.some((b) => b.bundle_sku === sku)) {
        phantomBundles.push({
          bundle_sku: sku,
          quota_static: Number(quotaRow.quota_static),
          stock_from_components: cap,
          phantom_units: phantom,
        });
      }
    }
  }

  return {
    duplicate_skus: duplicateSkus,
    orphan_boms: orphanBoms,
    missing_price: missingPrice,
    negative_stock: negativeStock,
    warehouse_breakdown_available: false,
    // ---- v2: phantom gate -------------------------------------------
    // Tanpa blok ini, webstore memutuskan oversell dari kuota statis saja.
    bundle_stock_available: bundleStock.length > 0,
    phantom_bundles: phantomBundles,
    phantom_exposure_units: phantomBundles.reduce((sum, b) => sum + b.phantom_units, 0),
    phantom_uncomputable: unknownBundles,
    // ---- v2: BOM coverage -------------------------------------------
    bundles_total: bundleSkus.length,
    bundles_with_bom: bomTargets.size,
    bundles_without_bom: bundlesWithoutBom.length,
    bundle_capacity: bundleCapacity,
  };
}

/**
 * Tarik seluruh master data yang dibutuhkan webstore, lalu bungkus jadi snapshot
 * bertanda tangan (sha256) supaya bisa diaudit & dibandingkan antar-run.
 */
export async function pullSnapshot(env = process.env) {
  const cfg = resolveErpConfig(env);

  const [productsRaw, balancesRaw, bomsRaw, warehousesRaw, operationalRaw] =
    await Promise.all([
      getJson(cfg, ERP_ENDPOINTS.products),
      getJson(cfg, ERP_ENDPOINTS.balances),
      getJson(cfg, ERP_ENDPOINTS.boms),
      getJson(cfg, ERP_ENDPOINTS.warehouses),
      getJson(cfg, ERP_ENDPOINTS.operational),
    ]);

  // Endpoint pelengkap: kegagalannya dicatat, tidak mematikan pull.
  const bundleStockResult = await getJsonOptional(cfg, ERP_ENDPOINTS.bundleStock);

  const data = {
    products: asArray(productsRaw, "products"),
    balances: asArray(balancesRaw, "products"),
    boms: asArray(bomsRaw, "boms"),
    warehouses: asArray(warehousesRaw, "warehouses"),
    operational: asArray(operationalRaw, "operational"),
    bundle_stock: bundleStockResult.ok
      ? firstArray(bundleStockResult.payload, "bundle_stock", "bundles")
      : [],
  };

  const checksum = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");

  return {
    version: 1,
    fetched_at: new Date().toISOString(),
    source: { base_url: cfg.baseUrl, endpoints: ERP_ENDPOINTS },
    counts: {
      products: data.products.length,
      balances: data.balances.length,
      boms: data.boms.length,
      warehouses: data.warehouses.length,
      operational: data.operational.length,
      bundle_stock: data.bundle_stock.length,
    },
    integrity: checkIntegrity(data),
    // Kalau bundle-stock gagal ditarik, penyebabnya ikut disimpan supaya
    // "tidak ada phantom" tidak pernah tertukar dengan "tidak bisa dibaca".
    bundle_stock_error: bundleStockResult.ok ? null : bundleStockResult.error,
    checksum,
    data,
  };
}