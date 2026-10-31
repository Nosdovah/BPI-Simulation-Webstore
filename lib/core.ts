import { getCatalog, findProductsBySkus, findProduct } from "./catalog";
import { getSold } from "./state";
import { resolveStockDisplay, stockMode, type ComponentStockMap, type StockMode } from "./stock";
import { liveStockSync } from "./erp/live-stock";
import type {
  BundleComponent,
  Gender,
  Product,
  ProductCard,
  ProductDetail,
} from "./types";

/**
 * Lapisan "osr-core" versi standalone.
 *
 * Di arsitektur penuh storefront memanggil core lewat HTTP. Di repo ini core
 * dijalankan in-process supaya webstore bisa berdiri sendiri tanpa Docker.
 *
 * ---------------------------------------------------------------- overlay ---
 * Kalau `lib/erp/live-stock.ts` punya angka ERP (±30 detik), angka itu yang
 * dipakai untuk stok & harga; snapshot hanya menyumbang master data (nama,
 * komposisi BOM, gambar). Efeknya:
 *
 *   - `stockDisplay` storefront = `stock_available` ERP  → uji A-04 = 0 selisih
 *   - penjualan tidak dikurangi lagi (ERP sudah memotong) → tidak dobel
 *   - ERP mati → otomatis kembali ke angka snapshot terakhir, bukan nol
 */

type OverlayCtx = {
  /** true kalau angka stok berasal dari overlay ERP, bukan snapshot */
  live: boolean;
  lookup: (p: Product) => { stock: number; sellPrice: number } | null;
};

function overlay(): OverlayCtx {
  const st = liveStockSync();
  if (!st.index || st.index.size === 0) {
    return { live: false, lookup: () => null };
  }
  return {
    live: true,
    lookup: (p: Product) => {
      const hit = st.index!.get(p.sku) ?? (p.materialCode ? st.index!.get(p.materialCode) : undefined);
      return hit ? { stock: hit.stock, sellPrice: hit.sellPrice } : null;
    },
  };
}

/** Produk dengan angka stok/harga dari ERP live (kalau tersedia). */
function withLive(p: Product, ctx: OverlayCtx): Product {
  if (!ctx.live) return p;
  const hit = ctx.lookup(p);
  if (!hit) return p;
  return {
    ...p,
    stockOnHand: hit.stock,
    priceIdr: hit.sellPrice > 0 ? hit.sellPrice : p.priceIdr,
  };
}

/**
 * Peta stok komponen untuk resolusi BOM (TO-BE).
 *
 * SUMBER KUNCI — temuan A-07
 *   Versi lama hanya memetakan `materialCode` milik produk SATUAN yang ada di
 *   snapshot. Komponen BOM di ERP memakai kode varian (mis.
 *   `M2188-ElixirHomme-50ml-A2`, `8677288521-1753362527282-0`) yang tidak
 *   selalu punya baris produk satuan sendiri → `map.get()` = undefined → 0 →
 *   halaman TO-BE menampilkan "BOM MIN n komponen: 0" padahal kapasitas nyata
 *   ribuan. Perbaikan: seluruh kunci overlay ERP (SKU kanonik, termasuk kode
 *   komponen) dimasukkan lebih dulu; produk satuan snapshot jadi cadangan.
 */
export function componentStocks(): ComponentStockMap {
  const ctx = overlay();
  const map: ComponentStockMap = new Map();

  // 1) Otoritas: peta stok ERP apa adanya (3.700+ kunci, termasuk kode komponen).
  if (ctx.live) {
    const st = liveStockSync();
    if (st.index) {
      for (const [key, entry] of Array.from(st.index)) {
        map.set(key, Math.max(0, entry.stock));
      }
    }
  }

  // 2) Cadangan: produk satuan snapshot (dipakai kalau overlay mati/kosong).
  for (const p of getCatalog()) {
    if (p.isBundle || !p.materialCode) continue;
    if (map.has(p.materialCode)) continue;
    const hit = ctx.live ? ctx.lookup(p) : null;
    const base = hit ? hit.stock : p.stockOnHand;
    const sold = hit ? 0 : getSold(p.materialCode);
    map.set(p.materialCode, Math.max(0, base - sold));
  }
  return map;
}

export function toCard(
  p: Product,
  stocks: ComponentStockMap,
  ctx: OverlayCtx = overlay(),
  mode: StockMode = stockMode(),
): ProductCard {
  const source = withLive(p, ctx);
  const stock = resolveStockDisplay(
    source,
    stocks,
    mode,
    // Overlay hidup = ERP pemilik pengurangan stok.
    ctx.live ? () => 0 : getSold,
  );
  return {
    id: source.id,
    sku: source.sku,
    slug: source.slug,
    name: source.name,
    gender: source.gender,
    collection: source.collection,
    priceIdr: source.priceIdr,
    compareAtIdr: source.compareAtIdr,
    imageKey: source.imageKey,
    isBundle: source.isBundle,
    sizeLabel: source.sizeLabel,
    stockDisplay: stock.value,
    stockLabel: stock.label,
    stockAware: stock.aware,
    stockError: stock.error,
  };
}

export function toDetail(
  p: Product,
  stocks: ComponentStockMap,
  ctx: OverlayCtx = overlay(),
  mode: StockMode = stockMode(),
): ProductDetail {
  const card = toCard(p, stocks, ctx, mode);
  const bundleComponents: BundleComponent[] = p.components.map((c) => {
    const componentProduct = findProduct(c.materialCode);
    /* Stok komponen SELALU dari peta komponen (kunci = materialCode). Versi
     * lama memakai `ctx.lookup(componentProduct ?? p)` — kalau produk komponen
     * tidak ada di snapshot, lookup jatuh ke produk BUNDLE itu sendiri dan
     * angka stok bundle dipakai sebagai stok komponen (salah, dan menutupi
     * bug A-07). */
    const fromMap = stocks.get(c.materialCode);
    const liveHit = ctx.live && componentProduct ? ctx.lookup(componentProduct) : null;
    return {
      sku: componentProduct?.sku ?? c.materialCode,
      materialCode: c.materialCode,
      name: componentProduct?.name ?? c.materialCode,
      multiplierQty: c.multiplierQty,
      componentStock: liveHit ? liveHit.stock : fromMap ?? 0,
    };
  });

  return {
    ...card,
    description: p.description,
    notes: p.notes,
    sizeMl: p.sizeMl,
    bundleComponents,
    stockPerWarehouse: p.stockPerWarehouse,
  };
}

export type ListParams = {
  gender?: Gender | "ALL";
  collection?: string;
  q?: string;
  page?: number;
  perPage?: number;
  sort?: "featured" | "price-asc" | "price-desc" | "stock-desc";
  bundlesOnly?: boolean;
  /** override mode tampilan stok (TO-BE = kapasitas BOM) untuk demo before→after */
  stockMode?: StockMode;
};

export type ListResult = {
  items: ProductCard[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  generatedAt: number;
};

export function listProducts(params: ListParams): ListResult {
  const {
    gender = "ALL",
    collection,
    q,
    page = 1,
    perPage = 48,
    sort = "featured",
    bundlesOnly = false,
    stockMode: modeOverride,
  } = params;

  const mode: StockMode = modeOverride ?? stockMode();
  const ctx = overlay();
  const stocks = componentStocks();
  const needle = q?.trim().toLowerCase();

  let filtered = getCatalog().filter((p) => {
    if (gender !== "ALL" && p.gender !== gender) return false;
    if (collection && p.collection !== collection) return false;
    if (bundlesOnly && !p.isBundle) return false;
    if (needle) {
      const haystack = `${p.name} ${p.sku} ${p.scent}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  if (sort === "featured") {
    // Urutan kurasi: rakitan lengkap → satuan → rakitan tanpa komposisi (BOM yatim).
    const rank = (p: Product) => (p.isBundle ? (p.components.length > 0 ? 0 : 2) : 1);
    filtered = [...filtered].sort((a, b) => rank(a) - rank(b));
  }

  const priced = filtered.map((p) => withLive(p, ctx));
  if (sort === "price-asc") priced.sort((a, b) => a.priceIdr - b.priceIdr);
  if (sort === "price-desc") priced.sort((a, b) => b.priceIdr - a.priceIdr);

  const total = priced.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * perPage;
  const slice = priced.slice(start, start + perPage);

  let items = slice.map((p) => toCard(p, stocks, ctx, mode));
  if (sort === "stock-desc") {
    items = [...items].sort((a, b) => (b.stockDisplay ?? -1) - (a.stockDisplay ?? -1));
  }

  return {
    items,
    total,
    page: safePage,
    perPage,
    totalPages,
    generatedAt: Date.now(),
  };
}

export function getProductDetail(idOrSlug: string, mode: StockMode = stockMode()): ProductDetail | null {
  const product = findProduct(idOrSlug);
  if (!product) return null;
  return toDetail(product, componentStocks(), overlay(), mode);
}

export function featuredProducts(limit = 8): ProductCard[] {
  const ctx = overlay();
  const stocks = componentStocks();
  const list = getCatalog();

  // Kurasi diturunkan dari data ERP: SKU rakitan (BOM) lebih dulu, lalu single
  // dengan sisa stok terbesar. Tidak ada SKU yang dipaku di kode.
  const available = (p: Product) => {
    const hit = ctx.live ? ctx.lookup(p) : null;
    if (hit) return Math.max(0, hit.stock);
    return Math.max(0, p.stockOnHand - getSold(p.materialCode ?? p.sku));
  };

  const bundles = list.filter((p) => p.isBundle && p.components.length > 0);
  const singles = list
    .filter((p) => !p.isBundle)
    .slice()
    .sort((a, b) => available(b) - available(a));

  const picks = [...bundles, ...singles].slice(0, limit);
  return picks.map((p) => toCard(p, stocks, ctx));
}

export type StockCheckLine = {
  sku: string;
  requested: number;
  available: number | null;
  ok: boolean;
  error: string | null;
};

export function checkStock(lines: Array<{ sku: string; qty: number }>, modeOverride?: StockMode): {
  lines: StockCheckLine[];
  ok: boolean;
} {
  const ctx = overlay();
  const stocks = componentStocks();
  const mode: StockMode = modeOverride ?? stockMode();
  const products = findProductsBySkus(lines.map((l) => l.sku));

  const result: StockCheckLine[] = lines.map((line) => {
    const product = products.find((p) => p.sku === line.sku);
    if (!product) {
      return { sku: line.sku, requested: line.qty, available: null, ok: false, error: "SKU tidak ditemukan" };
    }
    const source = withLive(product, ctx);
    const resolved = resolveStockDisplay(
      source,
      stocks,
      mode,
      ctx.live ? () => 0 : getSold,
    );
    if (resolved.error) {
      return { sku: line.sku, requested: line.qty, available: null, ok: false, error: resolved.error };
    }
    const available = resolved.value ?? 0;
    if (available < line.qty) {
      return {
        sku: line.sku,
        requested: line.qty,
        available,
        ok: false,
        error: `Stok tidak mencukupi (tersedia ${available})`,
      };
    }
    return { sku: line.sku, requested: line.qty, available, ok: true, error: null };
  });

  return { lines: result, ok: result.every((l) => l.ok) };
}

export function catalogStats() {
  const list = getCatalog();
  const bundles = list.filter((p) => p.isBundle);
  return {
    totalSkus: list.length,
    singles: list.length - bundles.length,
    bundles: bundles.length,
  };
}
