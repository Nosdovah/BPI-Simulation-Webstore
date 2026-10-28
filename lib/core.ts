import { getCatalog, findProductsBySkus, findProduct } from "./catalog";
import { getSold } from "./state";
import { resolveStockDisplay, type ComponentStockMap } from "./stock";
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
 */

export function componentStocks(): ComponentStockMap {
  const map: ComponentStockMap = new Map();
  for (const p of getCatalog()) {
    if (!p.isBundle && p.materialCode) {
      map.set(p.materialCode, Math.max(0, p.stockOnHand - getSold(p.materialCode)));
    }
  }
  return map;
}

export function toCard(p: Product, stocks: ComponentStockMap): ProductCard {
  const stock = resolveStockDisplay(p, stocks);
  return {
    id: p.id,
    sku: p.sku,
    slug: p.slug,
    name: p.name,
    gender: p.gender,
    collection: p.collection,
    priceIdr: p.priceIdr,
    compareAtIdr: p.compareAtIdr,
    imageKey: p.imageKey,
    isBundle: p.isBundle,
    sizeLabel: p.sizeLabel,
    stockDisplay: stock.value,
    stockLabel: stock.label,
    stockAware: stock.aware,
    stockError: stock.error,
  };
}

export function toDetail(p: Product, stocks: ComponentStockMap): ProductDetail {
  const card = toCard(p, stocks);
  const bundleComponents: BundleComponent[] = p.components.map((c) => {
    const componentProduct = findProduct(c.materialCode);
    return {
      sku: componentProduct?.sku ?? c.materialCode,
      materialCode: c.materialCode,
      name: componentProduct?.name ?? c.materialCode,
      multiplierQty: c.multiplierQty,
      componentStock: stocks.get(c.materialCode) ?? 0,
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
  } = params;

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
  if (sort === "price-asc") filtered = [...filtered].sort((a, b) => a.priceIdr - b.priceIdr);
  if (sort === "price-desc") filtered = [...filtered].sort((a, b) => b.priceIdr - a.priceIdr);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * perPage;
  const slice = filtered.slice(start, start + perPage);

  let items = slice.map((p) => toCard(p, stocks));
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

export function getProductDetail(idOrSlug: string): ProductDetail | null {
  const product = findProduct(idOrSlug);
  if (!product) return null;
  return toDetail(product, componentStocks());
}

export function featuredProducts(limit = 8): ProductCard[] {
  const stocks = componentStocks();
  const list = getCatalog();

  // Kurasi diturunkan dari data ERP: SKU rakitan (BOM) lebih dulu, lalu single
  // dengan sisa stok terbesar. Tidak ada SKU yang dipaku di kode.
  const available = (p: Product) =>
    Math.max(0, p.stockOnHand - getSold(p.materialCode ?? p.sku));

  const bundles = list.filter((p) => p.isBundle && p.components.length > 0);
  const singles = list
    .filter((p) => !p.isBundle)
    .slice()
    .sort((a, b) => available(b) - available(a));

  const picks = [...bundles, ...singles].slice(0, limit);
  return picks.map((p) => toCard(p, stocks));
}

export type StockCheckLine = {
  sku: string;
  requested: number;
  available: number | null;
  ok: boolean;
  error: string | null;
};

export function checkStock(lines: Array<{ sku: string; qty: number }>): {
  lines: StockCheckLine[];
  ok: boolean;
} {
  const stocks = componentStocks();
  const products = findProductsBySkus(lines.map((l) => l.sku));

  const result: StockCheckLine[] = lines.map((line) => {
    const product = products.find((p) => p.sku === line.sku);
    if (!product) {
      return { sku: line.sku, requested: line.qty, available: null, ok: false, error: "SKU tidak ditemukan" };
    }
    const resolved = resolveStockDisplay(product, stocks);
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