import { createHash } from "node:crypto";

/**
 * Puller ERP — satu-satunya tempat yang membaca API ERP (Jalur A / Modul 4.1).
 *
 * KONTRAK RESMI = replika Perpack (bukan blueprint-v2).
 * Rujukan: `docs/API_INTEGRATION.md` di repo `Nosdovah/BPI-Simulation-ERP`
 * dan `GET /openapi.json` di server ERP (sumber kanonik).
 *
 *   GET  /api/webhooks/catalog?page=&length=   master-data produk (flat)
 *   GET  /v1/products/list?page=&length=       varian flat
 *   GET  /v1/products/group/page?page=&length= grup + varian nested (stok per gudang)
 *   GET  /v1/channels                          daftar channel (13 = WEBSTORE)
 *   GET  /v1/warehouses                        daftar gudang
 *   GET  /api/to-be/bundle-stock?sku=&limit=   BOM: stock_to_be + phantom AS-IS vs TO-BE
 *   GET  /api/to-be/sales-summary              KPI sales order / sales product
 *
 * Endpoint /api/v2/* (blueprint-v2) SUDAH DITINGGALKAN — jangan dipakai lagi.
 *
 * Dipakai dua konsumen:
 *   1) scripts/erp-sync.mjs   → membangun snapshot di `.data/erp/`
 *   2) lib/erp/client.ts      → mode live (`OSR_CATALOG_SOURCE=live`)
 *
 * Sengaja ditulis JavaScript murni (bukan TS) supaya bisa di-import langsung
 * oleh skrip Node tanpa langkah build.
 */

/** ERP OSR — `Nosdovah/BPI-Simulation-ERP` (bukan MOAI SCM-ERP). */
export const DEFAULT_BASE_URL = "https://web-production-e60b55.up.railway.app";

/**
 * User-Agent browser wajib. Sebagian WAF/edge menolak UA non-browser
 * (mis. `node` atau `Python-urllib`) dengan 401 walau endpoint terbuka.
 */
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Path kanonik. Tidak ada `/api/v2/*` di sini — itu skema lama yang sudah
 * diganti replika Perpack.
 */
export const ERP_ENDPOINTS = {
  /** master-data produk untuk storefront (flat, sudah termasuk is_bundle + components) */
  catalog: "/api/webhooks/catalog",
  /** varian flat (atribut variasi, dimensi) */
  productsList: "/v1/products/list",
  /** grup produk + varian nested + `stocks[]` per gudang */
  groups: "/v1/products/group/page",
  channels: "/v1/channels",
  warehouses: "/v1/warehouses",
  /** baca balik sales order (40 field, kunci = reference_no) */
  ordersPage: "/v1/orders/page",
  /** tulis order dari checkout */
  purchaseOrder: "/api/webhooks/purchase-order",
  /** event order.status_changed / stock.updated + riwayatnya */
  wmsEvents: "/api/webhooks/wms",
  /** TO-BE: stok bundle = MIN(⌊stok komponen / multiplier⌋) + phantom */
  bundleStock: "/api/to-be/bundle-stock",
  /** TO-BE: KPI sales order / sales product */
  salesSummary: "/api/to-be/sales-summary",
};

/**
 * Server memotong `length` secara diam-diam: katalog maksimum 500, grup
 * maksimum 250. Kalau kita minta lebih, `metadata.length` ikut terpotong dan
 * `total_page` jadi menyesatkan — paginasi harus mengikuti angka yang
 * dikembalikan server, bukan yang kita minta.
 */
export const PAGE_LIMIT = {
  catalog: 500,
  groups: 250,
  bundleStock: 5000,
};

export function resolveErpConfig(env = process.env) {
  return {
    baseUrl: (env.OSR_ERP_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    /**
     * Auth ERP replica: OPSIONAL dan tanpa prefix `Bearer` (meniru Perpack
     * asli yang mengirim JWT mentah). Kosongkan untuk demo.
     */
    token: env.OSR_ERP_TOKEN || "",
    timeoutMs: Math.max(1000, Number(env.OSR_ERP_TIMEOUT_MS || 30000)),
    retries: Math.max(0, Number(env.OSR_ERP_RETRIES ?? 2)),
    /** 1 = ikut menarik stok per gudang (butuh /v1/products/group/page, ±5 MB) */
    warehouseStock: String(env.OSR_ERP_WAREHOUSE_STOCK ?? "1") !== "0",
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function authHeaders(cfg) {
  return cfg.token ? { Authorization: cfg.token } : {};
}

/** Envelope ERP: `{code, msg:{id,en}, data, metadata}`. `code != 200` = gagal. */
export function unwrap(json, path) {
  if (!json || typeof json !== "object") {
    throw new Error(`ERP ${path}: respons bukan objek JSON`);
  }
  const code = typeof json.code === "number" ? json.code : 200;
  if (code !== 200) {
    const msg = json.msg?.id || json.msg?.en || "error";
    const err = new Error(`ERP ${path} menjawab code=${code} (${msg})`);
    err.code = code;
    err.fatal = code >= 400 && code < 500;
    throw err;
  }
  return json;
}

/**
 * `/api/to-be/bundle-stock` punya DUA bentuk respons yang berbeda tergantung
 * parameter — ini jebakan kontrak yang wajib ditangani di satu tempat:
 *
 *   ?limit=N        → { summary, bundles: [...] }   (daftar)
 *   ?sku=<sku>      → satu objek bundle langsung      (detail)
 *   ?sku=<tidak ada>→ objek bundle dengan sku tsb, angka 0
 *
 * `?sku=` TIDAK mengembalikan `{bundles:[]}`. Kalau kode memakai
 * `data.bundles` untuk kasus `sku`, hasilnya selalu kosong dan bug ini senyap.
 */
export function normalizeBundleStock(data) {
  if (!data || typeof data !== "object") return { summary: null, bundles: [] };
  if (Array.isArray(data.bundles)) {
    return { summary: data.summary ?? null, bundles: data.bundles };
  }
  if (typeof data.sku === "string") {
    return { summary: null, bundles: [data] };
  }
  return { summary: data.summary ?? null, bundles: [] };
}

async function request(cfg, { method = "GET", path, body }) {
  const url = `${cfg.baseUrl}${path}`;
  let lastErr = null;

  for (let attempt = 0; attempt <= cfg.retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "application/json",
          ...authHeaders(cfg),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        const err = new Error(
          `ERP ${res.status} ${res.statusText} pada ${method} ${path}` +
            (json ? ` — ${JSON.stringify(json).slice(0, 240)}` : text ? ` — ${text.slice(0, 200)}` : ""),
        );
        err.status = res.status;
        err.payload = json;
        err.fatal = res.status >= 400 && res.status < 500;
        throw err;
      }
      return { status: res.status, json };
    } catch (err) {
      lastErr = err;
      if (err && err.fatal) break;
      if (attempt < cfg.retries) await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** GET + buka envelope. */
export async function getJson(cfg, path) {
  const { json } = await request(cfg, { path });
  return unwrap(json, path);
}

/** POST + buka envelope. */
export async function postJson(cfg, path, body) {
  const { json } = await request(cfg, { method: "POST", path, body });
  return unwrap(json, path);
}

/**
 * Tarik SEMUA halaman sebuah endpoint ter-paginasi.
 *
 * Berhenti kalau: (a) sudah mencapai `metadata.count`, (b) halaman kosong,
 * (c) halaman terakhir lebih pendek dari `length` yang dilaporkan server.
 * `complete=false` menandakan paginasi terpotong (mis. guard maxPages) —
 * itu dihitung sebagai temuan integritas, bukan diabaikan.
 */
export async function fetchAll(cfg, path, { length = PAGE_LIMIT.catalog, maxPages = 80 } = {}) {
  const rows = [];
  let meta = null;
  let page = 1;
  let complete = true;

  for (;;) {
    const json = await getJson(cfg, `${path}?page=${page}&length=${length}`);
    const data = Array.isArray(json.data) ? json.data : [];
    meta = json.metadata ?? meta;
    rows.push(...data);

    const count = Number(meta?.count ?? 0);
    if (data.length === 0) break;
    if (count > 0 && rows.length >= count) break;

    const servedLength = Number(meta?.length ?? length);
    if (data.length < servedLength) break;

    page += 1;
    if (page > maxPages) {
      complete = false;
      break;
    }
  }

  const expected = Number(meta?.count ?? rows.length);
  return { rows, meta, expected, complete: complete && rows.length >= expected };
}

/* ------------------------------------------------------------ integrity --- */

/**
 * Gate integritas master data. Dipakai `erp:sync` sebelum snapshot ditulis,
 * dan disimpan di dalam snapshot supaya bisa diaudit tanpa menarik ulang.
 */
export function checkIntegrity(data) {
  const products = Array.isArray(data.products) ? data.products : [];
  const bundles = products.filter((p) => p && p.is_bundle);

  const skus = new Set(products.map((p) => p?.sku).filter(Boolean));

  const seen = new Set();
  const duplicateSkus = [];
  for (const p of products) {
    if (!p?.sku) continue;
    if (seen.has(p.sku)) duplicateSkus.push(p.sku);
    seen.add(p.sku);
  }

  const bundlesWithoutComponents = [];
  const missingComponents = [];
  for (const b of bundles) {
    const comps = Array.isArray(b.components) ? b.components : [];
    if (comps.length === 0) {
      bundlesWithoutComponents.push(b.sku);
      continue;
    }
    const missing = comps
      .map((c) => c?.component_sku)
      .filter((sku) => sku && !skus.has(sku));
    if (missing.length > 0) {
      missingComponents.push({ sku: b.sku, missing });
    }
  }

  const missingPrice = products
    .filter((p) => !Number.isFinite(Number(p?.sell_price)) || Number(p.sell_price) <= 0)
    .map((p) => p.sku);

  const negativeStock = products
    .filter((p) => Number(p?.stock_available) < 0)
    .map((p) => p.sku);

  const toBe = data.bundleStock?.summary ?? null;

  return {
    /** `metadata.count` katalog vs jumlah baris yang benar-benar diterima */
    catalog_count_expected: Number(data.catalogMeta?.count ?? products.length),
    catalog_count_actual: products.length,
    catalog_pagination_complete: data.catalogMeta?.complete !== false,
    duplicate_skus: duplicateSkus,
    bundles_without_components: bundlesWithoutComponents,
    missing_components: missingComponents,
    missing_price: missingPrice,
    negative_stock: negativeStock,
    /** ringkasan TO-BE dari ERP: oversell / understate / matched */
    bundle_stock_summary: toBe,
    warehouse_breakdown_available: Array.isArray(data.variants)
      ? data.variants.some((v) => Array.isArray(v.stocks) && v.stocks.length > 0)
      : false,
  };
}

/* -------------------------------------------------------------- snapshot --- */

const slimGroup = (g) => ({
  id: g.id,
  name: g.name,
  product_group_id: g.id,
  thumbnail: g.thumbnail ?? "",
  description: g.description ?? "",
  brand: g.brand?.name ?? "",
  variant_count: Array.isArray(g.variants) ? g.variants.length : 0,
});

/**
 * Varian gabungan: atribut variasi + `stocks[]` per gudang datang dari
 * `/v1/products/group/page`; angka `stock_available` tetap dari katalog.
 */
function buildVariants(groups, warehouseStock) {
  if (!warehouseStock) return [];
  const out = [];
  for (const g of groups) {
    for (const v of Array.isArray(g.variants) ? g.variants : []) {
      out.push({
        sku: v.sku,
        product_group_id: g.id,
        variation_label: v.variation_label ?? "",
        variation_value: v.variation_value ?? "",
        weight: v.weight ?? null,
        type: v.type ?? "",
        is_bundle: Boolean(v.is_bundle),
        stocks: Array.isArray(v.stocks)
          ? v.stocks.map((s) => ({
              warehouse_id: s.id,
              warehouse_name: s.name,
              available: Number(s.available ?? 0),
              reserved: Number(s.reserved ?? 0),
              on_order: Number(s.on_order ?? 0),
            }))
          : [],
      });
    }
  }
  return out;
}

/**
 * Tarik seluruh data yang dibutuhkan storefront, lalu bungkus jadi snapshot
 * bertanda tangan (sha256) supaya bisa diaudit & dibandingkan antar-run.
 */
export async function pullSnapshot(env = process.env) {
  const cfg = resolveErpConfig(env);
  const started = Date.now();

  const [catalog, channelsRaw, warehousesRaw, bundleStockRaw, salesSummaryRaw] = await Promise.all([
    fetchAll(cfg, ERP_ENDPOINTS.catalog, { length: PAGE_LIMIT.catalog }),
    getJson(cfg, ERP_ENDPOINTS.channels),
    getJson(cfg, ERP_ENDPOINTS.warehouses),
    getJson(cfg, `${ERP_ENDPOINTS.bundleStock}?limit=${PAGE_LIMIT.bundleStock}`),
    getJson(cfg, ERP_ENDPOINTS.salesSummary),
  ]);

  /* Stok per gudang butuh grup + varian nested (payload besar). Opsional. */
  let groupsRaw = { rows: [], meta: null, expected: 0, complete: true };
  if (cfg.warehouseStock) {
    groupsRaw = await fetchAll(cfg, ERP_ENDPOINTS.groups, { length: PAGE_LIMIT.groups });
  }

  const bundleStockData = normalizeBundleStock(bundleStockRaw.data);
  const data = {
    /** master-data flat — sumber utama katalog storefront */
    products: catalog.rows,
    catalogMeta: {
      count: Number(catalog.meta?.count ?? catalog.rows.length),
      pages: Number(catalog.meta?.total_page ?? 0),
      complete: catalog.complete,
    },
    /** varian + stok per gudang (kosong kalau OSR_ERP_WAREHOUSE_STOCK=0) */
    variants: buildVariants(groupsRaw.rows, cfg.warehouseStock),
    groups: groupsRaw.rows.map(slimGroup),
    warehouses: Array.isArray(warehousesRaw.data) ? warehousesRaw.data : [],
    channels: Array.isArray(channelsRaw.data) ? channelsRaw.data : [],
    /** AS-IS vs TO-BE stok bundle (BOM MIN) */
    bundleStock: {
      summary: bundleStockData.summary ?? null,
      bundles: Array.isArray(bundleStockData.bundles) ? bundleStockData.bundles : [],
    },
    salesSummary: salesSummaryRaw.data ?? null,
  };

  const checksum = createHash("sha256").update(JSON.stringify(data)).digest("hex");

  const snapshot = {
    version: 2,
    contract: "perpack-replica",
    fetched_at: new Date().toISOString(),
    elapsed_ms: Date.now() - started,
    source: {
      base_url: cfg.baseUrl,
      endpoints: { ...ERP_ENDPOINTS },
      warehouse_stock: cfg.warehouseStock,
    },
    counts: {
      products: data.products.length,
      variants: data.variants.length,
      groups: data.groups.length,
      warehouses: data.warehouses.length,
      channels: data.channels.length,
      bundles: data.bundleStock.bundles.length,
    },
    integrity: checkIntegrity(data),
    checksum,
    data,
  };

  return snapshot;
}
