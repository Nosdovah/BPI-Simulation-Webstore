import type { Product } from "./types";
import type { LiveCatalogRow } from "./erp/live-catalog";

/**
 * Rekonsiliasi katalog storefront terhadap master data ERP.
 *
 * Dipisah dari `lib/catalog.ts` supaya bisa diuji deterministik (tanpa HTTP,
 * tanpa snapshot): masukkan produk baseline + peta master, periksa hasilnya.
 * Inilah inti klaim "item storefront mengikuti master data ERP":
 *
 *   - baris yang ada di dua sisi  → nama/harga/flag bundle/BOM disegarkan
 *   - SKU ada di master, tidak di toko   → ditambahkan (tanpa build ulang)
 *   - SKU ada di toko, tidak di master   → dihapus, TAPI hanya kalau master
 *     dianggap lengkap (mode "master", semua halaman tertarik, jumlah baris
 *     ≥ pruneMin). Data tidak lengkap ≠ data dihapus.
 */

export type ReconcileOptions = {
  /** "master" = /api/webhooks/catalog, "products" = fallback, "off" = jangan sentuh */
  mode: "master" | "products" | "off";
  /** semua halaman master berhasil ditarik? */
  complete: boolean;
  pruneOn: boolean;
  pruneMin: number;
  /** dipakai untuk membangun `Product` bagi SKU baru (dari mapper) */
  buildProduct: (row: LiveCatalogRow, index: number) => Product;
  /** override sinkronisasi baris; default `syncProductFromMaster` */
  sync?: (p: Product, row: LiveCatalogRow) => boolean;
};

export type ReconcileResult = {
  products: Product[];
  updated: number;
  added: number;
  removed: number;
  /** true kalau prune benar-benar dijalankan (bukan sekadar diizinkan) */
  pruned: boolean;
};

/**
 * Terapkan satu baris master ke produk yang sudah ada (mutasi di tempat).
 * Return true kalau ada field item yang berubah (nama/harga/bundle/BOM).
 */
export function syncProductFromMaster(p: Product, hit: LiveCatalogRow): boolean {
  const item = hit.item;
  let changed = false;

  if (hit.name && hit.name !== p.name) {
    p.name = hit.name;
    changed = true;
  }
  if (hit.sellPrice > 0 && hit.sellPrice !== p.priceIdr) {
    p.priceIdr = hit.sellPrice;
    changed = true;
  }

  const isBundle = Boolean(item.is_bundle);
  const components = (Array.isArray(item.components) ? item.components : []).map((c) => ({
    materialCode: c.component_sku,
    multiplierQty: Math.max(1, Math.round(Number(c.multiplier_qty) || 1)),
  }));
  const sameComponents =
    components.length === p.components.length &&
    components.every(
      (c, i) =>
        c.materialCode === p.components[i]?.materialCode &&
        c.multiplierQty === p.components[i]?.multiplierQty,
    );
  if (isBundle !== p.isBundle || !sameComponents) {
    p.isBundle = isBundle;
    p.kind = isBundle ? "BUNDLE" : "EDP";
    p.components = components;
    p.materialCode = isBundle ? null : p.sku;
    changed = true;
  }

  // Stok: cadangan saja. Angka yang disajikan tetap dari overlay stok live
  // (TTL 30 dtk) — jadi tidak dihitung sebagai "perubahan item".
  const stock = Number(item.stock_available);
  if (Number.isFinite(stock) && stock !== p.stockOnHand) {
    p.stockOnHand = stock;
  }

  return changed;
}

export function reconcileCatalog(
  base: Product[],
  master: Map<string, LiveCatalogRow>,
  opts: ReconcileOptions,
): ReconcileResult {
  const trustworthy = opts.mode === "master" && opts.complete;
  const prune = opts.pruneOn && trustworthy && master.size >= opts.pruneMin;
  const canAdd = trustworthy;
  const sync = opts.sync ?? syncProductFromMaster;

  const products: Product[] = [];
  const seen = new Set<string>();
  let updated = 0;
  let removed = 0;
  let added = 0;

  for (const p of base) {
    const hit = master.get(p.sku);
    if (!hit) {
      if (prune) {
        removed += 1;
        continue;
      }
      products.push(p);
      continue;
    }
    seen.add(p.sku);
    if (sync(p, hit)) updated += 1;
    products.push(p);
  }

  if (canAdd) {
    for (const [sku, row] of Array.from(master)) {
      if (seen.has(sku)) continue;
      products.push(opts.buildProduct(row, products.length));
      added += 1;
    }
  }

  return { products, updated, added, removed, pruned: prune };
}