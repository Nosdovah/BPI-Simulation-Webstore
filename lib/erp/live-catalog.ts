import { resolveErpConfig, getJson, ERP_ENDPOINTS } from "./pull.mjs";

/**
 * Overlay MASTER KATALOG dari ERP (Jalur A — baca) — menutup temuan A-02.
 *
 * MASALAH
 *   Snapshot `.data/erp/catalog.snapshot.json` dibangun saat build. Setelah
 *   deploy, nama & harga produk tidak pernah berubah lagi sampai ada build
 *   baru — katalog "beku". Stok sudah punya overlay 30 detik
 *   (`lib/erp/live-stock.ts`), tetapi master data (nama, harga, flag bundle)
 *   masih dari file.
 *
 * KENAPA HARGA/NAMA, BUKAN SELURUH KATALOG
 *   Komposisi BOM & gambar nyaris tidak berubah dan mahal untuk ditarik
 *   (3 query per SKU di sisi ERP). Yang berubah harian adalah HARGA dan NAMA.
 *   Keduanya tersedia murah di `GET /v1/products/list?page=&length=`
 *   (8–16 request untuk 3.700 SKU). Jadi yang di-overlay: nama, harga,
 *   flag bundle, dan keberadaan SKU baru.
 *
 * KONTRAK
 *   - TTL 300 detik, stale-while-revalidate. Request pengguna tidak menunggu.
 *   - ERP mati → pakai hasil tarik terakhir; kalau belum pernah ada, snapshot.
 *   - `OSR_CATALOG_OVERLAY=off` mematikan overlay (uji A/B).
 *   - SKU baru yang belum ada di snapshot TIDAK ditambahkan (butuh komposisi
 *     BOM + gambar; itu jalur build `npm run erp:sync`). Yang dihitung:
 *     berapa SKU snapshot yang harganya/nama-nya sudah disegarkan.
 */

export type LiveCatalogRow = {
  sku: string;
  name: string;
  sellPrice: number;
  isBundle: boolean;
};

export type LiveCatalogState = {
  map: Map<string, LiveCatalogRow> | null;
  fetchedAt: number | null;
  ageMs: number | null;
  fresh: boolean;
  skuCount: number;
  pages: number;
  lastError: string | null;
  /** jumlah produk yang nilainya benar-benar berubah saat overlay diterapkan */
  appliedCount: number;
};

const TTL_MS = Number(process.env.OSR_CATALOG_TTL_MS ?? 300_000);
const PAGE_LENGTH = 500;
const MAX_PAGES = 40;

type Store = {
  map: Map<string, LiveCatalogRow> | null;
  fetchedAt: number | null;
  pages: number;
  lastError: string | null;
  appliedCount: number;
  inflight: Promise<void> | null;
};

const g = globalThis as unknown as { __osrLiveCatalog?: Store };

function store(): Store {
  if (!g.__osrLiveCatalog) {
    g.__osrLiveCatalog = { map: null, fetchedAt: null, pages: 0, lastError: null, appliedCount: 0, inflight: null };
  }
  return g.__osrLiveCatalog;
}

export function catalogOverlayEnabled(env = process.env): boolean {
  return String(env.OSR_CATALOG_OVERLAY ?? "on").toLowerCase() !== "off";
}

type ErpVariant = {
  sku?: unknown;
  name?: unknown;
  sell_price?: unknown;
  is_bundle?: unknown;
};

/** Normalisasi satu halaman `/v1/products/list` → baris overlay. */
export function normalizeCatalogPage(payload: unknown): Map<string, LiveCatalogRow> {
  const out = new Map<string, LiveCatalogRow>();
  const rows = (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const r = raw as ErpVariant;
    const sku = typeof r?.sku === "string" ? r.sku : "";
    if (!sku) continue;
    out.set(sku, {
      sku,
      name: typeof r.name === "string" ? r.name : "",
      sellPrice: Number(r.sell_price ?? 0) || 0,
      isBundle: Boolean(r.is_bundle),
    });
  }
  return out;
}

async function pull(): Promise<void> {
  const s = store();
  const cfg = resolveErpConfig();
  const map = new Map<string, LiveCatalogRow>();
  const path = (page: number) => `${ERP_ENDPOINTS.productsList}?page=${page}&length=${PAGE_LENGTH}`;

  /* Halaman 1 dulu: dari `metadata` kita tahu `total_page` yang dilayani ERP
   * (3.712 SKU = 15 halaman @250). Sisanya ditarik PARALEL 5 sekaligus —
   * sekuensial 15 request butuh 5–8 detik dan itu terlalu lama untuk
   * stale-while-revalidate di serverless. */
  const first = (await getJson(cfg, path(1))) as {
    metadata?: { count?: number; length?: number; total_page?: number };
  };
  const firstBatch = normalizeCatalogPage(first);
  if (firstBatch.size === 0) throw new Error("products/list kosong — overlay katalog tidak diterapkan");
  for (const [sku, row] of Array.from(firstBatch)) map.set(sku, row);

  const count = Number(first?.metadata?.count ?? 0) || 0;
  const totalPages = Math.min(
    MAX_PAGES,
    Number(first?.metadata?.total_page ?? 0) || Math.ceil(count / Math.max(1, firstBatch.size)) || 1,
  );

  const remaining: number[] = [];
  for (let p = 2; p <= totalPages; p += 1) remaining.push(p);

  const CHUNK = 5;
  for (let i = 0; i < remaining.length; i += CHUNK) {
    const slice = remaining.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map((p) => getJson(cfg, path(p)).catch(() => null)),
    );
    for (const json of results) {
      for (const [sku, row] of Array.from(normalizeCatalogPage(json))) map.set(sku, row);
    }
  }

  s.map = map;
  s.fetchedAt = Date.now();
  s.pages = totalPages;
  s.lastError = null;
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

export async function liveCatalog(waitMs = 0): Promise<LiveCatalogState> {
  const s = store();
  if (!catalogOverlayEnabled()) return snapshotState(s);
  const age = s.fetchedAt ? Date.now() - s.fetchedAt : null;
  if (age === null || age > TTL_MS) {
    const p = refreshLiveCatalog();
    if (waitMs > 0) await Promise.race([p, new Promise((r) => setTimeout(r, waitMs))]);
  }
  return snapshotState(s);
}

/** Versi sinkron (Server Components): pakai cache apa adanya, picu refresh. */
export function liveCatalogSync(): LiveCatalogState {
  const s = store();
  if (!catalogOverlayEnabled()) return snapshotState(s);
  const age = s.fetchedAt ? Date.now() - s.fetchedAt : null;
  if (age === null || age > TTL_MS) void refreshLiveCatalog();
  return snapshotState(s);
}

function snapshotState(s: Store): LiveCatalogState {
  const ageMs = s.fetchedAt ? Date.now() - s.fetchedAt : null;
  return {
    map: s.map,
    fetchedAt: s.fetchedAt,
    ageMs,
    fresh: ageMs !== null && ageMs <= TTL_MS,
    skuCount: s.map ? s.map.size : 0,
    pages: s.pages,
    lastError: s.lastError,
    appliedCount: s.appliedCount,
  };
}

export function noteApplied(count: number): void {
  store().appliedCount = count;
}

export function catalogFreshnessSync() {
  const st = liveCatalogSync();
  const cfg = resolveErpConfig();
  return {
    source: st.map ? "erp-live" : "snapshot",
    erp_base_url: cfg.baseUrl,
    fetched_at: st.fetchedAt ? new Date(st.fetchedAt).toISOString() : null,
    age_seconds: st.ageMs === null ? null : Math.round(st.ageMs / 1000),
    ttl_seconds: Math.round(TTL_MS / 1000),
    fresh: st.fresh,
    sku_count: st.skuCount,
    pages: st.pages,
    applied_count: st.appliedCount,
    error: st.lastError,
  };
}

export function resetLiveCatalog(): void {
  g.__osrLiveCatalog = undefined;
}