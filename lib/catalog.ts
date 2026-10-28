import type { CollectionSlug, Product } from "./types";
import { loadSnapshotSync } from "./erp/client";
import {
  buildCatalogFromSnapshot,
  collectionsOf,
  segmentsOf,
  type CatalogMeta,
} from "./erp/mapper";

/* ------------------------------------------------------------------ *
 * Katalog storefront.
 *
 * TIDAK ADA katalog hardcoded di sini. Seluruh produk, harga, stok, dan
 * komposisi BOM berasal dari master data ERP (MOAI SCM-ERP) lewat snapshot
 * ber-checksum di `.data/erp/catalog.snapshot.json`.
 *
 * Alur:  ERP REST API → npm run erp:sync → snapshot → mapper → Product[]
 *
 * Kalau snapshot belum ada, modul ini melempar error yang menyebutkan
 * perintah perbaikannya — bukan diam-diam memakai data contoh.
 * ------------------------------------------------------------------ */

let cached: Product[] | null = null;
let cachedMeta: CatalogMeta | null = null;
let orphanBoms: string[] = [];

let cachedBySku: Map<string, Product> | null = null;
let cachedById: Map<number, Product> | null = null;
let cachedBySlug: Map<string, Product> | null = null;
let cachedByMaterial: Map<string, Product> | null = null;

function load() {
  if (cached) return;
  const { source, snapshot } = loadSnapshotSync();
  const built = buildCatalogFromSnapshot(snapshot, source);
  cached = built.products;
  cachedMeta = built.meta;
  orphanBoms = built.orphanBomSkus;
}

export function getCatalog(): Product[] {
  load();
  return cached as Product[];
}

/** Metadata sumber data — dipakai panel simulasi untuk menampilkan jejak integrasi. */
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
 * SKU unggulan untuk hero & panel simulasi: bundle BOM yang komposisinya
 * lengkap, kalau tidak ada pakai produk pertama. Tidak ada SKU yang dipaku.
 */
export function flagshipSku(): string | null {
  const list = getCatalog();
  const bundle = list.find((p) => p.isBundle && p.components.length > 0);
  return (bundle ?? list.find((p) => !p.isBundle) ?? list[0])?.sku ?? null;
}