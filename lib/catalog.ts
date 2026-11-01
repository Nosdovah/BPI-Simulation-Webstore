import type { CollectionSlug, Product } from "./types";
import { loadSnapshotSync } from "./erp/client";
import { liveCatalogSync, noteApplied, type LiveCatalogRow } from "./erp/live-catalog";
import { reconcileCatalog } from "./catalog-reconcile";
import {
  buildCatalogFromSnapshot,
  collectionsOf,
  segmentsOf,
  toProduct,
  type CatalogMeta,
} from "./erp/mapper";
import type { ErpBundleStock, ErpGroup, ErpVariant } from "./erp/types";

/* ------------------------------------------------------------------ *
 * Katalog storefront.
 *
 * TIDAK ADA katalog hardcoded di sini. Seluruh produk, harga, stok, dan
 * komposisi BOM berasal dari master data ERP (MOAI SCM-ERP) lewat snapshot
 * ber-checksum di `.data/erp/catalog.snapshot.json`.
 *
 * Alur:  ERP REST API → npm run erp:sync → snapshot → mapper → Product[]
 *
 * Sejak pass 27 master data TIDAK LAGI BEKU di snapshot. Snapshot hanya
 * baseline; overlay master (`lib/erp/live-catalog.ts`, sumber
 * `GET /api/webhooks/catalog` — endpoint yang sama dengan halaman master data
 * ERP) merekonsiliasi katalog tiap TTL:
 *
 *   - produk di ERP          → nama, harga, flag bundle, komposisi BOM disegarkan
 *   - SKU baru di ERP        → DITAMBAHKAN sebagai produk toko (tanpa build ulang)
 *   - SKU dihapus di ERP     → DIHAPUS dari katalog toko (prune ber-guard)
 *   - stok                   → tetap dari overlay stok live (TTL 30 dtk)
 *
 * Kalau snapshot belum ada, modul ini melempar error yang menyebutkan
 * perintah perbaikannya — bukan diam-diam memakai data contoh.
 * ------------------------------------------------------------------ */

let cached: Product[] | null = null;
let cachedMeta: CatalogMeta | null = null;
let orphanBoms: string[] = [];

/** baseline dari snapshot — objek produk dipakai ulang, bukan dibangun ulang */
let base: Product[] | null = null;
let variantBySku = new Map<string, ErpVariant>();
let groupById = new Map<number, ErpGroup>();
let bundleStockBySku = new Map<string, ErpBundleStock>();

let cachedBySku: Map<string, Product> | null = null;
let cachedById: Map<number, Product> | null = null;
let cachedBySlug: Map<string, Product> | null = null;
let cachedByMaterial: Map<string, Product> | null = null;

let appliedFetchAt: number | null = null;

/** Guard prune: jangan pernah menghapus kalau master tidak kelihatan lengkap. */
const PRUNE_MIN = Number(process.env.OSR_CATALOG_PRUNE_MIN ?? 3000);
const PRUNE_ON = String(process.env.OSR_CATALOG_PRUNE ?? "on").toLowerCase() !== "off";

function resetIndexes(): void {
  cachedBySku = null;
  cachedById = null;
  cachedBySlug = null;
  cachedByMaterial = null;
}

/**
 * Rekonsiliasi katalog terhadap master data ERP.
 *
 * Dijalankan tiap kali `fetchedAt` overlay berubah (≤ sekali per TTL 120 dtk),
 * bukan tiap request. Produk yang tidak berubah tetap memakai objek yang sama
 * supaya referensi di halaman daftar dan halaman detail konsisten.
 */
function applyCatalogOverlay(): void {
  if (!base) return;
  const st = liveCatalogSync();
  if (!st.map || st.fetchedAt === null || st.fetchedAt === appliedFetchAt) return;

  const r = reconcileCatalog(base, st.map, {
    mode: st.mode,
    complete: st.complete,
    pruneOn: PRUNE_ON,
    pruneMin: PRUNE_MIN,
    buildProduct: (row, index) =>
      toProduct(
        row.item,
        variantBySku.get(row.sku),
        groupById.get(Number(row.item.product_group_id)),
        bundleStockBySku.get(row.sku),
        index,
      ),
  });

  cached = r.products;
  resetIndexes();
  appliedFetchAt = st.fetchedAt;
  noteApplied({ updated: r.updated, added: r.added, removed: r.removed });
}

function load() {
  if (!cached) {
    const { source, snapshot } = loadSnapshotSync();
    const built = buildCatalogFromSnapshot(snapshot, source);
    base = built.products;
    cached = built.products;
    cachedMeta = built.meta;
    orphanBoms = built.orphanBomSkus;

    variantBySku = new Map();
    for (const v of snapshot.data.variants ?? []) variantBySku.set(v.sku, v);
    groupById = new Map();
    for (const g of snapshot.data.groups ?? []) groupById.set(Number(g.id), g);
    bundleStockBySku = new Map();
    for (const b of snapshot.data.bundleStock?.bundles ?? []) bundleStockBySku.set(b.sku, b);
  }
  applyCatalogOverlay();
}

export function getCatalog(): Product[] {
  load();
  return cached as Product[];
}

/** Metadata sumber data — jejak integrasi ERP (base URL, snapshot, checksum). */
export function getCatalogMeta(): CatalogMeta {
  load();
  return cachedMeta as CatalogMeta;
}

/** SKU target BOM yang tidak ada di master products (integritas referensial). */
export function getOrphanBomSkus(): string[] {
  load();
  return orphanBoms;
}

function index() {
  if (!cachedBySku) {
    const list = getCatalog();
    cachedBySku = new Map(list.map((p) => [p.sku, p]));
    cachedById = new Map(list.map((p) => [p.id, p]));
    cachedBySlug = new Map(list.map((p) => [p.slug, p]));
    cachedByMaterial = new Map(
      list
        .filter((p) => p.materialCode)
        .map((p) => [p.materialCode as string, p]),
    );
  }
  return {
    bySku: cachedBySku as Map<string, Product>,
    byId: cachedById as Map<number, Product>,
    bySlug: cachedBySlug as Map<string, Product>,
    byMaterial: cachedByMaterial as Map<string, Product>,
  };
}

/** Cari produk satuan berdasarkan kode material (= SKU di ERP). */
export function findProductByMaterial(materialCode: string): Product | null {
  return index().byMaterial.get(materialCode) ?? null;
}

export function findProduct(idOrSlugOrSku: string): Product | null {
  const { bySku, byId, bySlug } = index();
  const asNumber = Number(idOrSlugOrSku);
  if (!Number.isNaN(asNumber) && Number.isInteger(asNumber)) {
    const byIdHit = byId.get(asNumber);
    if (byIdHit) return byIdHit;
  }
  return bySku.get(idOrSlugOrSku) ?? bySlug.get(idOrSlugOrSku) ?? null;
}

export function findProductsBySkus(skus: string[]): Product[] {
  const { bySku } = index();
  return skus.map((s) => bySku.get(s)).filter((p): p is Product => Boolean(p));
}

/** Koleksi diturunkan dari `item_type` master data ERP. */
export function getCollections(): Array<{
  slug: CollectionSlug;
  title: string;
  subtitle: string;
  total: number;
}> {
  return collectionsOf(getCatalog());
}

/** Segmen (brand) diturunkan dari master data ERP — dipakai filter di UI. */
export function getSegments(): Array<{ key: string; total: number }> {
  return segmentsOf(getCatalog());
}

export function catalogTotal(): number {
  return getCatalog().length;
}

/**
 * SKU unggulan untuk hero: bundle BOM yang komposisinya
 * lengkap, kalau tidak ada pakai produk pertama. Tidak ada SKU yang dipaku.
 */
export function flagshipSku(): string | null {
  const list = getCatalog();
  const bundle = list.find((p) => p.isBundle && p.components.length > 0);
  return (bundle ?? list.find((p) => !p.isBundle) ?? list[0])?.sku ?? null;
}