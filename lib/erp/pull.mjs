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

  return {
    duplicate_skus: duplicateSkus,
    orphan_boms: orphanBoms,
    missing_price: missingPrice,
    negative_stock: negativeStock,
    warehouse_breakdown_available: false,
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

  const data = {
    products: asArray(productsRaw, "products"),
    balances: asArray(balancesRaw, "products"),
    boms: asArray(bomsRaw, "boms"),
    warehouses: asArray(warehousesRaw, "warehouses"),
    operational: asArray(operationalRaw, "operational"),
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
    },
    integrity: checkIntegrity(data),
    checksum,
    data,
  };
}