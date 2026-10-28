import type { Product } from "../types";
import type { ErpBalance, ErpProduct, ErpSnapshot } from "./types";

/**
 * Mapper ERP → bentuk `Product` yang dipakai storefront.
 *
 * Aturan: TIDAK ADA nilai data yang di-hardcode di sini. Semua field berasal dari
 * snapshot ERP. Yang ada di file ini hanya transformasi bentuk + penamaan UI.
 */

export type CatalogMeta = {
  source: "snapshot" | "live";
  baseUrl: string;
  fetchedAt: string;
  checksum: string;
  counts: ErpSnapshot["counts"];
  integrity: ErpSnapshot["integrity"];
};

export type BuiltCatalog = {
  products: Product[];
  meta: CatalogMeta;
  /** SKU yang muncul sebagai target BOM tetapi tidak ada di master products. */
  orphanBomSkus: string[];
};

const slugify = (input: string) =>
  input
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const num = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Segmen = brand master data. Dipakai sebagai dimensi filter di UI. */
const segmentOf = (p: ErpProduct) => (p.brand || "UNBRANDED").trim().toUpperCase();

/** Koleksi = item_type master data (`PREBUILT` → `prebuilt`). */
const collectionOf = (p: ErpProduct) => slugify(p.item_type || "uncategorized");

const sizeLabelOf = (p: ErpProduct) => p.category || p.uom || p.item_type || "—";

const descriptionOf = (p: ErpProduct) => {
  const parts = [
    p.specs,
    p.category ? `Kategori ${p.category}.` : null,
    p.warranty ? `Garansi ${p.warranty}.` : null,
    p.uom ? `Satuan ${p.uom}.` : null,
  ].filter(Boolean);
  return parts.join(" ").trim() || p.name;
};

export function buildCatalogFromSnapshot(
  snapshot: ErpSnapshot,
  source: CatalogMeta["source"] = "snapshot",
): BuiltCatalog {
  const productBySku = new Map<string, ErpProduct>();
  for (const p of snapshot.data.products) productBySku.set(p.sku, p);

  const balanceBySku = new Map<string, ErpBalance>();
  for (const b of snapshot.data.balances) balanceBySku.set(b.sku, b);

  const products: Product[] = [];
  const orphanBomSkus: string[] = [];

  const nextId = () => products.length + 1;

  /** 1. BOM → produk bundle. Target yang tidak ada di master tetap dicatat (orphan). */
  const bundleTargets = new Set<string>();

  for (const bom of snapshot.data.boms) {
    const target = productBySku.get(bom.target_sku);
    const rawComponents = Array.isArray(bom.components) ? bom.components : [];
    const resolvedComponents = rawComponents.filter((c) => productBySku.has(c.component_sku));

    if (!target) {
      orphanBomSkus.push(bom.target_sku);
    }

    bundleTargets.add(bom.target_sku);

    const components = resolvedComponents.map((c) => ({
      materialCode: c.component_sku,
      multiplierQty: Math.max(1, Math.round(num(c.qty, 1))),
    }));

    const rawSum = resolvedComponents.reduce((acc, c) => {
      const comp = productBySku.get(c.component_sku);
      return acc + num(comp?.unit_price) * Math.max(1, Math.round(num(c.qty, 1)));
    }, 0);

    const labor = num(bom.labor_cost);
    const overhead = num(bom.overhead_cost);
    // Kuota manual = stok yang dilaporkan ERP untuk SKU target (bukan hasil hitung komponen).
    const manualQuota = num(
      balanceBySku.get(bom.target_sku)?.stock_on_hand ?? target?.stock,
      0,
    );

    products.push({
      id: nextId(),
      sku: bom.target_sku,
      slug: slugify(bom.target_sku),
      name: target?.name ?? bom.name ?? bom.target_sku,
      scent: target?.brand ?? "",
      gender: target ? segmentOf(target) : "UNBRANDED",
      collection: target ? collectionOf(target) : "assembly",
      sizeLabel: `Assembly ${components.length} komponen`,
      sizeMl: 0,
      kind: "BUNDLE",
      priceIdr: rawSum > 0 ? rawSum + labor + overhead : labor + overhead,
      compareAtIdr: rawSum > 0 ? rawSum : null,
      imageKey: bom.target_sku,
      isBundle: true,
      materialCode: null,
      components,
      baselineQuota: manualQuota,
      stockPerWarehouse: [],
      notes: {
        top: [bom.version ? `BOM ${bom.version}` : "BOM"],
        heart: components.length ? [`${components.length} komponen`] : ["komposisi tidak lengkap"],
        base: [target?.warranty ?? "—"],
      },
      description:
        `${bom.name ? `${bom.name}. ` : ""}` +
        (components.length
          ? `Dirakit dari ${components.length} komponen master: ` +
            resolvedComponents
              .map((c) => `${c.component_sku} x${Math.max(1, Math.round(num(c.qty, 1)))}`)
              .join(", ") +
            "."
          : "Komposisi BOM tidak dapat dipetakan ke master produk — angka stok paket tidak bisa dihitung.") +
        (labor || overhead ? ` Biaya jasa rakit ${labor}, overhead ${overhead}.` : ""),
    });
  }

  /** 2. Master product → produk satuan (target BOM dilewati karena sudah jadi bundle). */
  for (const p of snapshot.data.products) {
    if (bundleTargets.has(p.sku)) continue;

    const balance = balanceBySku.get(p.sku);
    const price = num(p.unit_price, num(p.wholesale_price, 0));
    const wholesale = num(p.wholesale_price, 0);

    products.push({
      id: nextId(),
      sku: p.sku,
      slug: slugify(p.sku),
      name: p.name,
      scent: p.brand ?? "",
      gender: segmentOf(p),
      collection: collectionOf(p),
      sizeLabel: sizeLabelOf(p),
      sizeMl: 0,
      kind: p.item_type === "PREBUILT" ? "EXTRAIT" : "EDP",
      priceIdr: price,
      compareAtIdr: wholesale > price && price > 0 ? wholesale : null,
      imageKey: p.sku,
      isBundle: false,
      materialCode: p.sku,
      components: [],
      baselineQuota: num(balance?.stock_on_hand ?? p.stock, 0),
      // ERP belum mengirim stok per gudang; sengaja dikosongkan daripada dikarang.
      stockPerWarehouse: [],
      notes: {
        top: [p.brand ?? "—"],
        heart: [p.category ?? p.item_type ?? "—"],
        base: [p.warranty ?? "—"],
      },
      description: descriptionOf(p),
    });
  }

  return {
    products,
    meta: {
      source,
      baseUrl: snapshot.source.base_url,
      fetchedAt: snapshot.fetched_at,
      checksum: snapshot.checksum,
      counts: snapshot.counts,
      integrity: snapshot.integrity,
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

/** Segmen (brand) untuk filter, urut dari jumlah SKU terbanyak. */
export function segmentsOf(products: Product[]) {
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.gender, (counts.get(p.gender) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, total]) => ({ key, total }));
}