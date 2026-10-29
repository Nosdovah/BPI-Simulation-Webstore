import type { Product, WarehouseStock } from "../types";
import type {
  ErpBundleStock,
  ErpCatalogItem,
  ErpGroup,
  ErpSnapshot,
  ErpVariant,
} from "./types";

/**
 * Mapper ERP → bentuk `Product` yang dipakai storefront.
 *
 * Aturan: TIDAK ADA nilai data yang di-hardcode di sini. Semua field berasal dari
 * respons ERP. Yang ada di file ini hanya transformasi bentuk + penamaan UI.
 *
 * Sumber per field (kontrak replika Perpack):
 *   sku / name / sell_price / is_bundle / components[]  ← /api/webhooks/catalog
 *   stock_available                                     ← /api/webhooks/catalog
 *   variation_label / variation_value / stocks[]        ← /v1/products/group/page
 *   stock_to_be / phantom                               ← /api/to-be/bundle-stock
 *   description / brand                                 ← /v1/products/group/page
 */

export type CatalogMeta = {
  source: "snapshot" | "live";
  contract: ErpSnapshot["contract"];
  baseUrl: string;
  fetchedAt: string;
  checksum: string;
  counts: ErpSnapshot["counts"];
  integrity: ErpSnapshot["integrity"];
  /** KPI TO-BE dari ERP (AS-IS vs BOM) — dipakai halaman audit & paper. */
  bundleStockSummary: ErpSnapshot["integrity"]["bundle_stock_summary"];
};

export type BuiltCatalog = {
  products: Product[];
  meta: CatalogMeta;
  /** SKU komponen yang dirujuk bundling tetapi tidak ada di master products. */
  orphanBomSkus: string[];
};

const slugify = (input: string) =>
  String(input)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const num = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Ukuran ml dari SKU / nilai variasi (`M1058-...-20ml-A1` → 20). */
const mlOf = (...candidates: Array<string | undefined>) => {
  for (const c of candidates) {
    const m = String(c ?? "").match(/(\d+)\s*ml/i);
    if (m) return Number(m[1]);
  }
  return 0;
};

/**
 * Segmen/filter. Diturunkan dari kode seri produk di SKU
 * (`M1058-SagewoodSeaSalty-20ml-A1` → `M1058`) — pengelompokan nyata dari
 * master data, bukan daftar brand karangan.
 */
const seriesOf = (sku: string) => {
  const head = String(sku).split(/[-+]/)[0]?.trim();
  return (head || "LAINNYA").toUpperCase();
};

/** Koleksi = tipe varian ERP; bundling dipisah supaya bisa difilter. */
const collectionOf = (item: ErpCatalogItem, variant?: ErpVariant) => {
  if (item.is_bundle) return "bundling";
  const type = (variant?.type || "").trim();
  return type ? slugify(type) : "satuan";
};

const stripHtml = (input?: string) =>
  String(input ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function warehouseStocksOf(variant?: ErpVariant): WarehouseStock[] {
  if (!variant || !Array.isArray(variant.stocks)) return [];
  return variant.stocks.map((s) => ({
    warehouseId: Number(s.warehouse_id),
    warehouseName: s.warehouse_name,
    available: num(s.available),
    reserved: num(s.reserved),
  }));
}

export function buildCatalogFromSnapshot(
  snapshot: ErpSnapshot,
  source: CatalogMeta["source"] = "snapshot",
): BuiltCatalog {
  const variantBySku = new Map<string, ErpVariant>();
  for (const v of snapshot.data.variants ?? []) variantBySku.set(v.sku, v);

  const groupById = new Map<number, ErpGroup>();
  for (const g of snapshot.data.groups ?? []) groupById.set(Number(g.id), g);

  const bundleStockBySku = new Map<string, ErpBundleStock>();
  for (const b of snapshot.data.bundleStock?.bundles ?? []) bundleStockBySku.set(b.sku, b);

  const masterSkus = new Set(snapshot.data.products.map((p) => p.sku));
  const orphanBomSkus: string[] = [];

  const products: Product[] = snapshot.data.products.map((item, index) => {
    const variant = variantBySku.get(item.sku);
    const group = groupById.get(Number(item.product_group_id));
    const bundleStock = bundleStockBySku.get(item.sku);

    const components = (Array.isArray(item.components) ? item.components : []).map((c) => ({
      materialCode: c.component_sku,
      multiplierQty: Math.max(1, Math.round(num(c.multiplier_qty, 1))),
    }));

    if (item.is_bundle) {
      for (const c of components) {
        if (!masterSkus.has(c.materialCode) && !orphanBomSkus.includes(c.materialCode)) {
          orphanBomSkus.push(c.materialCode);
        }
      }
    }

    const asIs = num(item.stock_available);
    const toBe = item.is_bundle && bundleStock ? num(bundleStock.stock_to_be) : asIs;
    const phantom = item.is_bundle && bundleStock ? num(bundleStock.phantom) : 0;

    const sizeLabel =
      variant?.variation_value?.trim() ||
      (variant?.variation_label ? `${variant.variation_label} —` : "") ||
      (variant?.weight ? `${variant.weight} g` : "—");

    return {
      id: Number(item.id ?? index + 1),
      sku: item.sku,
      slug: slugify(item.sku),
      name: item.name,
      scent: variant?.variation_value?.trim() || item.alias || seriesOf(item.sku),
      gender: seriesOf(item.sku),
      collection: collectionOf(item, variant),
      sizeLabel,
      sizeMl: mlOf(variant?.variation_value, item.sku, item.name),
      kind: item.is_bundle ? "BUNDLE" : "EDP",
      priceIdr: num(item.sell_price),
      compareAtIdr: null,
      imageKey: item.sku,
      isBundle: Boolean(item.is_bundle),
      materialCode: item.is_bundle ? null : item.sku,
      components,
      stockOnHand: asIs,
      stockToBe: toBe,
      phantom,
      stockPerWarehouse: warehouseStocksOf(variant),
      notes: {
        top: [variant?.variation_label || "—", variant?.variation_value || "—"].filter(Boolean),
        heart: [item.alias || item.sku_code || "—"],
        base: [item.is_bundle ? `Bundling ${components.length} komponen` : "Satuan"],
      },
      description:
        stripHtml(group?.description) ||
        (item.is_bundle && components.length
          ? `Paket bundling dari ${components
              .map((c) => `${c.materialCode} ×${c.multiplierQty}`)
              .join(", ")}.`
          : item.name),
    };
  });

  return {
    products,
    meta: {
      source,
      contract: snapshot.contract,
      baseUrl: snapshot.source.base_url,
      fetchedAt: snapshot.fetched_at,
      checksum: snapshot.checksum,
      counts: snapshot.counts,
      integrity: snapshot.integrity,
      bundleStockSummary: snapshot.integrity?.bundle_stock_summary ?? null,
    },
    orphanBomSkus,
  };
}

/** Koleksi diturunkan dari data (bukan daftar tetap). */
export function collectionsOf(products: Product[]) {
  const seen = new Map<string, { slug: string; title: string; subtitle: string; total: number }>();
  for (const p of products) {
    const current = seen.get(p.collection);
    if (current) {
      current.total += 1;
      continue;
    }
    seen.set(p.collection, {
      slug: p.collection,
      title: p.collection.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      subtitle: `Item bertipe ${p.collection.replace(/-/g, " ")} dari master data ERP`,
      total: 1,
    });
  }
  return Array.from(seen.values()).sort((a, b) => b.total - a.total);
}

/** Segmen (seri produk) untuk filter, urut dari jumlah SKU terbanyak. */
export function segmentsOf(products: Product[]) {
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.gender, (counts.get(p.gender) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, total]) => ({ key, total }));
}
