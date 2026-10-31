import { resolveErpConfig, getJson } from "./pull.mjs";

/**
 * Overlay stok LIVE dari ERP (Jalur A — baca).
 *
 * MASALAH YANG DIPERBAIKI
 *   Katalog storefront dibangun dari snapshot ber-checksum. Snapshot itu bagus
 *   untuk master data (nama, harga, komposisi BOM) tetapi buruk untuk stok:
 *   angka yang dijual bisa tertinggal berjam-jam dari gudang. Audit 31 Okt 2026
 *   menemukan selisih nyata (M2291: storefront 9.976 vs ERP 9.975).
 *
 * KENAPA OVERLAY, BUKAN GANTI SUMBER
 *   Menarik katalog penuh dari ERP pada setiap request berarti memindahkan
 *   komponen + gambar untuk 3.712 SKU. Yang bergerak tiap detik hanyalah STOK.
 *   Jadi: master data tetap dari snapshot, angka stok ditimpa dari
 *   `GET /api/webhooks/stock-index` (satu query agregasi, ±40 KB gzip).
 *
 * KONTRAK
 *   - TTL 30 detik; setelah lewat TTL, angka lama tetap dipakai sementara
 *     refresh berjalan di latar (stale-while-revalidate). Request pengguna
 *     TIDAK PERNAH menunggu ERP.
 *   - ERP mati → overlay memakai nilai terakhir yang diketahui; kalau belum
 *     pernah ada sama sekali, `liveStock()` mengembalikan null dan pemanggil
 *     kembali ke angka snapshot (tidak ada angka karangan).
 *   - `OSR_STOCK_OVERLAY=off` mematikan overlay (dipakai untuk uji A/B).
 */

export type LiveStockEntry = {
  sku: string;
  stock: number;
  sellPrice: number;
  isBundle: boolean;
};

export type LiveStockState = {
  /** peta sku → entri; null = belum pernah berhasil menarik */
  index: Map<string, LiveStockEntry> | null;
  fetchedAt: number | null;
  /** `generated_at` dari ERP (jam ERP, bukan jam server storefront) */
  generatedAt: string | null;
  lastError: string | null;
  ageMs: number | null;
  fresh: boolean;
};

const TTL_MS = Number(process.env.OSR_STOCK_TTL_MS ?? 30_000);

type Store = {
  index: Map<string, LiveStockEntry> | null;
  fetchedAt: number | null;
  generatedAt: string | null;
  lastError: string | null;
  inflight: Promise<void> | null;
};

const g = globalThis as unknown as { __osrLiveStock?: Store };

function store(): Store {
  if (!g.__osrLiveStock) {
    g.__osrLiveStock = { index: null, fetchedAt: null, generatedAt: null, lastError: null, inflight: null };
  }
  return g.__osrLiveStock;
}

export function stockOverlayEnabled(env = process.env): boolean {
  return String(env.OSR_STOCK_OVERLAY ?? "on").toLowerCase() !== "off";
}

type StockIndexResponse = {
  data?: {
    items?: Array<{ sku?: string; stock_available?: number; sell_price?: number; is_bundle?: boolean }>;
    generated_at?: string;
    count?: number;
  };
};

async function pull(depth = 0): Promise<void> {
  const s = store();
  const cfg = resolveErpConfig();
  const json = (await getJson(cfg, "/api/webhooks/stock-index")) as StockIndexResponse["data"] &
    Record<string, unknown>;

  /* `getJson` sudah membuka envelope `{code,msg,data}` dan mengembalikan `data`,
   * tetapi pada beberapa build ERP `data` dibungkus lagi. Tangani keduanya tanpa
   * menebak: cari array `items` di kedalaman satu. */
  const payload = (json as unknown as StockIndexResponse["data"]) ?? {};
  const items = payload.items ?? (json as unknown as { data?: { items?: unknown[] } }).data?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("stock-index kosong / bentuk respons tidak dikenal");
  }

  const index = new Map<string, LiveStockEntry>();
  for (const it of items as Array<{ sku?: string; stock_available?: number; sell_price?: number; is_bundle?: boolean }>) {
    const sku = typeof it?.sku === "string" ? it.sku : null;
    if (!sku) continue;
    index.set(sku, {
      sku,
      stock: Number(it.stock_available ?? 0) || 0,
      sellPrice: Number(it.sell_price ?? 0) || 0,
      isBundle: Boolean(it.is_bundle),
    });
  }

  s.index = index;
  s.fetchedAt = Date.now();
  s.generatedAt = payload.generated_at ?? null;
  s.lastError = null;

  /* Satu halaman saja tidak cukup kalau SKU > length default. Hitung dari
   * `count` ERP dan tarik sisanya halaman demi halaman (maks 5, ~20.000 SKU). */
  const count = Number(payload.count ?? index.size) || index.size;
  if (index.size < count && depth < 5) {
    const cfg2 = resolveErpConfig();
    const next = await getJson(cfg2, `/api/webhooks/stock-index?page=${depth + 2}&length=10000`);
    const moreItems = (next as unknown as { items?: unknown[] })?.items;
    if (Array.isArray(moreItems)) {
      for (const it of moreItems as Array<{ sku?: string; stock_available?: number; sell_price?: number; is_bundle?: boolean }>) {
        const sku = typeof it?.sku === "string" ? it.sku : null;
        if (!sku) continue;
        s.index.set(sku, {
          sku,
          stock: Number(it.stock_available ?? 0) || 0,
          sellPrice: Number(it.sell_price ?? 0) || 0,
          isBundle: Boolean(it.is_bundle),
        });
      }
    }
    if (moreItems && moreItems.length > 0) await pull(depth + 1);
  }
}

/** Refresh di latar. Aman dipanggil berkali-kali; satu penerbangan sekaligus. */
export function refreshLiveStock(): Promise<void> {
  const s = store();
  if (s.inflight) return s.inflight;
  s.inflight = pull()
    .catch((err) => {
      s.lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[erp] overlay stok gagal: ${s.lastError}`);
    })
    .finally(() => {
      s.inflight = null;
    });
  return s.inflight;
}

/**
 * Baca overlay tanpa menunggu ERP.
 *
 * @param waitMs kalau cache kosong/basi, tunggu maksimal selama ini (dipakai di
 *               route API yang memang boleh menunggu). Default 0 = jangan tunggu.
 */
export async function liveStock(waitMs = 0): Promise<LiveStockState> {
  const s = store();
  const enabled = stockOverlayEnabled();
  if (!enabled) {
    return { index: null, fetchedAt: null, generatedAt: null, lastError: null, ageMs: null, fresh: false };
  }

  const age = s.fetchedAt ? Date.now() - s.fetchedAt : null;
  const stale = age === null || age > TTL_MS;

  if (stale) {
    const p = refreshLiveStock();
    if (waitMs > 0) {
      await Promise.race([p, new Promise((r) => setTimeout(r, waitMs))]);
    }
  }

  const nowAge = s.fetchedAt ? Date.now() - s.fetchedAt : null;
  return {
    index: s.index,
    fetchedAt: s.fetchedAt,
    generatedAt: s.generatedAt,
    lastError: s.lastError,
    ageMs: nowAge,
    fresh: nowAge !== null && nowAge <= TTL_MS,
  };
}

/** Versi sinkron untuk Server Components: pakai cache apa adanya, picu refresh. */
export function liveStockSync(): LiveStockState {
  const s = store();
  const enabled = stockOverlayEnabled();
  if (!enabled) {
    return { index: null, fetchedAt: null, generatedAt: null, lastError: null, ageMs: null, fresh: false };
  }
  const age = s.fetchedAt ? Date.now() - s.fetchedAt : null;
  if (age === null || age > TTL_MS) void refreshLiveStock();
  return {
    index: s.index,
    fetchedAt: s.fetchedAt,
    generatedAt: s.generatedAt,
    lastError: s.lastError,
    ageMs: age,
    fresh: age !== null && age <= TTL_MS,
  };
}

/** Ringkasan kesegaran data untuk ditampilkan di UI (audit-able). */
export async function stockFreshness(waitMs = 0) {
  const st = await liveStock(waitMs);
  const cfg = resolveErpConfig();
  return {
    source: st.index ? "erp-live" : "snapshot",
    erp_base_url: cfg.baseUrl,
    erp_generated_at: st.generatedAt,
    fetched_at: st.fetchedAt ? new Date(st.fetchedAt).toISOString() : null,
    age_seconds: st.ageMs === null ? null : Math.round(st.ageMs / 1000),
    ttl_seconds: Math.round(TTL_MS / 1000),
    fresh: st.fresh,
    sku_count: st.index ? st.index.size : 0,
    error: st.lastError,
  };
}

export function resetLiveStock() {
  g.__osrLiveStock = undefined;
}
