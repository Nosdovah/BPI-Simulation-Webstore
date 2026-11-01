import { resolveErpConfig, getJson, ERP_ENDPOINTS } from "./pull.mjs";
import type { ErpCatalogItem } from "./types";

/**
 * Overlay MASTER KATALOG dari ERP (Jalur A — baca).
 *
 * RIWAYAT
 *   v1 (A-02): snapshot `.data/erp/catalog.snapshot.json` dibangun saat build,
 *   jadi nama & harga produk "beku" sampai ada build baru. Overlay v1 hanya
 *   menimpa nama/harga/flag bundle dari `GET /v1/products/list`, dan TIDAK
 *   pernah menambah atau menghapus produk.
 *
 *   Akibatnya: SKU yang dibuat di master data ERP tidak muncul di storefront
 *   sampai `npm run erp:sync` + build ulang, dan SKU yang dihapus di ERP tetap
 *   dijual. Stok sudah live (TTL 30 dtk), item belum.
 *
 * v2 (pass 27): otoritas item pindah ke `GET /api/webhooks/catalog` — endpoint
 *   yang sama yang dipakai halaman master data ERP. Satu halaman 500 baris
 *   (8 request untuk 3.700 SKU) sudah memuat seluruh field yang dibutuhkan
 *   storefront: sku, name, sell_price, is_bundle, components[], stock_available,
 *   images[]. Maka overlay sekarang bisa:
 *
 *     - MENIMPA nama/harga/flag bundle/komposisi BOM baris yang sudah ada
 *     - MENAMBAH SKU baru sebagai produk toko (tanpa build ulang)
 *     - MENGHAPUS produk yang sudah tidak ada di master ERP (prune ber-guard)
 *
 * KONTRAK
 *   - TTL `OSR_CATALOG_TTL_MS` (default 120 dtk), stale-while-revalidate.
 *     Request pengguna tidak pernah menunggu ERP.
 *   - Respons halaman pertama menentukan `total_page`; sisanya ditarik paralel
 *     4 sekaligus. Kalau ada halaman gagal, `complete=false` dan pemanggil
 *     DILARANG melakukan prune (data tidak lengkap ≠ data dihapus).
 *   - `OSR_CATALOG_OVERLAY=off` mematikan overlay (uji A/B).
 *   - Fallback: kalau `/api/webhooks/catalog` gagal total, pakai
 *     `/v1/products/list` (mode "products": hanya timpa nama/harga, tanpa
 *     tambah/hapus) — storefront tidak boleh kosong karena satu endpoint mati.
 */

export type LiveCatalogRow = {
  /** baris master apa adanya — dipakai mapper untuk membangun Product */
  item: ErpCatalogItem;
  sku: string;
  name: string;
  sellPrice: number;
  isBundle: boolean;
};

export type CatalogOverlayMode = "master" | "products" | "off";

export type LiveCatalogState = {
  map: Map<string, LiveCatalogRow> | null;
  fetchedAt: number | null;
  ageMs: number | null;
  fresh: boolean;
  skuCount: number;
  pages: number;
  lastError: string | null;
  /** "master" = /api/webhooks/catalog (boleh tambah/hapus), "products" = fallback */
  mode: CatalogOverlayMode;
  /** true kalau semua halaman master berhasil ditarik */
  complete: boolean;
  /** jumlah SKU menurut metadata ERP pada tarikan terakhir */
  masterCount: number | null;
  /** hasil penerapan terakhir ke katalog storefront */
  applied: { updated: number; added: number; removed: number };
};

const TTL_MS = Number(process.env.OSR_CATALOG_TTL_MS ?? 120_000);
const PAGE_LENGTH = 500;
const MAX_PAGES = 40;

type Store = {
  map: Map<string, LiveCatalogRow> | null;
  fetchedAt: number | null;
  pages: number;
  mode: CatalogOverlayMode;
  complete: boolean;
  masterCount: number | null;
  lastError: string | null;
  applied: { updated: number; added: number; removed: number };
  inflight: Promise<void> | null;
};

const g = globalThis as unknown as { __osrLiveCatalog?: Store };

function store(): Store {
  if (!g.__osrLiveCatalog) {
    g.__osrLiveCatalog = {
      map: null,
      fetchedAt: null,
      pages: 0,
      mode: "off",
      complete: false,
      masterCount: null,
      lastError: null,
      applied: { updated: 0, added: 0, removed: 0 },
      inflight: null,
    };
  }
  return g.__osrLiveCatalog;
}

export function catalogOverlayEnabled(env = process.env): boolean {
  return String(env.OSR_CATALOG_OVERLAY ?? "on").toLowerCase() !== "off";
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Normalisasi satu halaman `/api/webhooks/catalog` → baris overlay master. */
export function normalizeMasterPage(payload: unknown): Map<string, LiveCatalogRow> {
  const out = new Map<string, LiveCatalogRow>();
  const rows = (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const item = raw as ErpCatalogItem;
    const sku = str(item?.sku).trim();
    // A-15: baris tanpa SKU tidak pernah boleh menjadi produk toko.
    if (!sku) continue;
    out.set(sku, {
      item: {
        ...item,
        sku,
        name: str(item.name),
        components: Array.isArray(item.components) ? item.components : [],
      },
      sku,
      name: str(item.name),
      sellPrice: Number(item.sell_price ?? 0) || 0,
      isBundle: Boolean(item.is_bundle),
    });
  }
  return out;
}

/** Fallback lama: `/v1/products/list` (tanpa komponen/stock; hanya timpa). */
export function normalizeCatalogPage(payload: unknown): Map<string, LiveCatalogRow> {
  const out = new Map<string, LiveCatalogRow>();
  const rows = (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const sku = str(r?.sku).trim();
    if (!sku) continue;
    out.set(sku, {
      item: {
        id: Number(r.id ?? 0) || 0,
        product_group_id: Number(r.product_group_id ?? 0) || 0,
        name: str(r.name),
        sku,
        sku_code: str(r.sku_code),
        alias: str(r.alias),
        sell_price: Number(r.sell_price ?? 0) || 0,
        is_bundle: Boolean(r.is_bundle),
        components: [],
        images: [],
        stock_available: Number(r.stock_available ?? 0) || 0,
      },
      sku,
      name: str(r.name),
      sellPrice: Number(r.sell_price ?? 0) || 0,
      isBundle: Boolean(r.is_bundle),
    });
  }
  return out;
}

type PageMeta = { count?: number; total_page?: number };

async function pullMaster(cfg: ReturnType<typeof resolveErpConfig>): Promise<{
  map: Map<string, LiveCatalogRow>;
  pages: number;
  complete: boolean;
  masterCount: number | null;
}> {
  const path = (page: number) => `${ERP_ENDPOINTS.catalog}?page=${page}&length=${PAGE_LENGTH}`;
  const first = (await getJson(cfg, path(1))) as { metadata?: PageMeta };
  const map = normalizeMasterPage(first);
  if (map.size === 0) throw new Error("master catalog kosong — overlay tidak diterapkan");

  const meta = (first?.metadata ?? {}) as PageMeta;
  const masterCount = Number(meta.count ?? 0) || null;
  const totalPages = Math.min(
    MAX_PAGES,
    Number(meta.total_page ?? 0) || Math.ceil((masterCount ?? map.size) / Math.max(1, map.size)) || 1,
  );

  const remaining: number[] = [];
  for (let p = 2; p <= totalPages; p += 1) remaining.push(p);

  let failed = 0;
  const CHUNK = 4;
  for (let i = 0; i < remaining.length; i += CHUNK) {
    const slice = remaining.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map((p) =>
        getJson(cfg, path(p)).then(
          (json) => json,
          () => {
            failed += 1;
            return null;
          },
        ),
      ),
    );
    for (const json of results) {
      for (const [sku, row] of Array.from(normalizeMasterPage(json))) map.set(sku, row);
    }
  }

  return { map, pages: totalPages, complete: failed === 0, masterCount };
}

async function pullProducts(cfg: ReturnType<typeof resolveErpConfig>): Promise<{
  map: Map<string, LiveCatalogRow>;
  pages: number;
  complete: boolean;
  masterCount: number | null;
}> {
  const path = (page: number) => `${ERP_ENDPOINTS.productsList}?page=${page}&length=${PAGE_LENGTH}`;
  const first = (await getJson(cfg, path(1))) as { metadata?: PageMeta };
  const map = normalizeCatalogPage(first);
  if (map.size === 0) throw new Error("products/list kosong — overlay tidak diterapkan");

  const meta = (first?.metadata ?? {}) as PageMeta;
  const masterCount = Number(meta.count ?? 0) || null;
  const totalPages = Math.min(
    MAX_PAGES,
    Number(meta.total_page ?? 0) || Math.ceil((masterCount ?? map.size) / Math.max(1, map.size)) || 1,
  );

  let failed = 0;
  const CHUNK = 5;
  const remaining: number[] = [];
  for (let p = 2; p <= totalPages; p += 1) remaining.push(p);
  for (let i = 0; i < remaining.length; i += CHUNK) {
    const slice = remaining.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map((p) =>
        getJson(cfg, path(p)).then(
          (json) => json,
          () => {
            failed += 1;
            return null;
          },
        ),
      ),
    );
    for (const json of results) {
      for (const [sku, row] of Array.from(normalizeCatalogPage(json))) map.set(sku, row);
    }
  }

  return { map, pages: totalPages, complete: failed === 0, masterCount };
}

async function pull(): Promise<void> {
  const s = store();
  const cfg = resolveErpConfig();

  try {
    const r = await pullMaster(cfg);
    s.map = r.map;
    s.pages = r.pages;
    s.complete = r.complete;
    s.masterCount = r.masterCount;
    s.mode = "master";
    s.lastError = r.complete ? null : "sebagian halaman master gagal ditarik (prune dinonaktifkan)";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fallback: jangan biarkan katalog kosong karena satu endpoint.
    const r = await pullProducts(cfg);
    s.map = r.map;
    s.pages = r.pages;
    s.complete = r.complete;
    s.masterCount = r.masterCount;
    s.mode = "products";
    s.lastError = `master gagal (${msg}) — fallback products/list`;
  }

  s.fetchedAt = Date.now();
}

export function refreshLiveCatalog(): Promise<void> {
  const s = store();
  if (s.inflight) return s.inflight;
  s.inflight = pull()
    .catch((err) => {
      s.lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[erp] overlay katalog gagal: ${s.lastError}`);
    })
    .finally(() => {
      s.inflight = null;
    });
  return s.inflight;
}

function state(s: Store): LiveCatalogState {
  const ageMs = s.fetchedAt ? Date.now() - s.fetchedAt : null;
  return {
    map: s.map,
    fetchedAt: s.fetchedAt,
    ageMs,
    fresh: ageMs !== null && ageMs <= TTL_MS,
    skuCount: s.map ? s.map.size : 0,
    pages: s.pages,
    lastError: s.lastError,
    mode: s.mode,
    complete: s.complete,
    masterCount: s.masterCount,
    applied: s.applied,
  };
}

export async function liveCatalog(waitMs = 0): Promise<LiveCatalogState> {
  const s = store();
  if (!catalogOverlayEnabled()) {
    s.mode = "off";
    return state(s);
  }
  const age = s.fetchedAt ? Date.now() - s.fetchedAt : null;
  if (age === null || age > TTL_MS) {
    const p = refreshLiveCatalog();
    if (waitMs > 0) await Promise.race([p, new Promise((r) => setTimeout(r, waitMs))]);
  }
  return state(s);
}

/** Versi sinkron (Server Components): pakai cache apa adanya, picu refresh. */
export function liveCatalogSync(): LiveCatalogState {
  const s = store();
  if (!catalogOverlayEnabled()) {
    s.mode = "off";
    return state(s);
  }
  const age = s.fetchedAt ? Date.now() - s.fetchedAt : null;
  if (age === null || age > TTL_MS) void refreshLiveCatalog();
  return state(s);
}

/** Catat hasil penerapan overlay ke katalog (dipakai /api/catalog/freshness). */
export function noteApplied(applied: { updated: number; added: number; removed: number }): void {
  store().applied = applied;
}

export function catalogFreshnessSync() {
  const st = liveCatalogSync();
  const cfg = resolveErpConfig();
  return {
    source: st.map ? "erp-live" : "snapshot",
    mode: st.mode,
    erp_base_url: cfg.baseUrl,
    endpoint: st.mode === "master" ? ERP_ENDPOINTS.catalog : ERP_ENDPOINTS.productsList,
    fetched_at: st.fetchedAt ? new Date(st.fetchedAt).toISOString() : null,
    age_seconds: st.ageMs === null ? null : Math.round(st.ageMs / 1000),
    ttl_seconds: Math.round(TTL_MS / 1000),
    fresh: st.fresh,
    sku_count: st.skuCount,
    master_count: st.masterCount,
    complete: st.complete,
    pages: st.pages,
    applied: st.applied,
    applied_count: st.applied.updated + st.applied.added + st.applied.removed,
    error: st.lastError,
  };
}

export function resetLiveCatalog(): void {
  g.__osrLiveCatalog = undefined;
}