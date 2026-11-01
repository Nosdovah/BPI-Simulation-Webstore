/**
 * Uji deterministik rekonsiliasi katalog ↔ master data ERP.
 *
 * Tidak memanggil HTTP dan tidak memakai snapshot: murni logika
 * `lib/catalog-reconcile.ts`. Tujuannya membuktikan tiga klaim yang tidak bisa
 * dibuktikan hanya dari paritas data produksi:
 *
 *   1. SKU BARU di master ERP benar-benar DITAMBAHKAN ke katalog toko
 *   2. SKU yang DIHAPUS di master ERP benar-benar DIHAPUS dari katalog toko
 *   3. guard bekerja: master tidak lengkap / mode fallback TIDAK menghapus apa pun
 *
 * Jalankan: npx -y tsx scripts/test-catalog-reconcile.ts
 */
import { reconcileCatalog, syncProductFromMaster } from "../lib/catalog-reconcile";
import type { Product } from "../lib/types";
import type { LiveCatalogRow } from "../lib/erp/live-catalog";

let failed = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failed += 1;
};

const product = (sku: string, name: string, price: number, isBundle = false): Product =>
  ({
    id: Math.abs(sku.split("").reduce((a, c) => a + c.charCodeAt(0), 0)),
    sku,
    slug: sku.toLowerCase(),
    name,
    scent: sku,
    gender: "M",
    collection: "satuan",
    sizeLabel: "—",
    sizeMl: 0,
    kind: isBundle ? "BUNDLE" : "EDP",
    priceIdr: price,
    compareAtIdr: null,
    imageKey: sku,
    isBundle,
    materialCode: isBundle ? null : sku,
    components: [],
    stockOnHand: 0,
    stockToBe: 0,
    phantom: 0,
    stockPerWarehouse: [],
    notes: { top: [], heart: [], base: [] },
    description: name,
  }) as Product;

const row = (
  sku: string,
  name: string,
  price: number,
  opts: { bundle?: boolean; components?: Array<{ component_sku: string; multiplier_qty: number }>; stock?: number } = {},
): LiveCatalogRow => ({
  sku,
  name,
  sellPrice: price,
  isBundle: Boolean(opts.bundle),
  item: {
    id: 1,
    product_group_id: 1,
    name,
    sku,
    sell_price: price,
    is_bundle: Boolean(opts.bundle),
    components: (opts.components ?? []).map((c) => ({ product_id: 1, ...c })),
    images: [],
    stock_available: opts.stock ?? 100,
  },
});

const build = (r: LiveCatalogRow, i: number) => product(r.sku, r.name, r.sellPrice);

/* ------------------------------------------------------------------ *
 * Kasus 1 — master lengkap: timpa + tambah, tanpa hapus
 * ------------------------------------------------------------------ */
{
  const base = [product("A-1", "Lama A", 1000), product("B-1", "Lama B", 2000, true)];
  const master = new Map<string, LiveCatalogRow>([
    ["A-1", row("A-1", "Nama Baru A", 1500)],
    ["B-1", row("B-1", "Lama B", 2000, { bundle: true, components: [{ component_sku: "A-1", multiplier_qty: 2 }] })],
    ["C-9", row("C-9", "SKU Baru dari ERP", 7500)],
  ]);
  const r = reconcileCatalog(base, master, { mode: "master", complete: true, pruneOn: true, pruneMin: 1, buildProduct: build });
  ok("kasus 1: sku baru ditambahkan", r.added === 1 && r.products.some((p) => p.sku === "C-9"), `added=${r.added}`);
  ok("kasus 1: nama & harga ditimpa master", r.updated === 2 && r.products[0].name === "Nama Baru A" && r.products[0].priceIdr === 1500, `updated=${r.updated}`);
  ok("kasus 1: BOM bundle ikut master", r.products[1].components.length === 1 && r.products[1].components[0].materialCode === "A-1");
  ok("kasus 1: tidak ada yang dihapus", r.removed === 0 && r.products.length === 3, `removed=${r.removed}`);
}

/* ------------------------------------------------------------------ *
 * Kasus 2 — SKU dihapus di master: prune berjalan
 * ------------------------------------------------------------------ */
{
  const base = [product("A-1", "A", 1000), product("DEL-1", "Sudah dihapus di ERP", 900)];
  const master = new Map<string, LiveCatalogRow>([["A-1", row("A-1", "A", 1000)]]);
  const r = reconcileCatalog(base, master, { mode: "master", complete: true, pruneOn: true, pruneMin: 1, buildProduct: build });
  ok("kasus 2: SKU yang dihapus di ERP hilang dari toko", r.removed === 1 && !r.products.some((p) => p.sku === "DEL-1"), `removed=${r.removed}`);
  ok("kasus 2: pruned dilaporkan true", r.pruned === true);
}

/* ------------------------------------------------------------------ *
 * Kasus 3 — guard: master tidak lengkap / di bawah ambang → JANGAN hapus
 * ------------------------------------------------------------------ */
{
  const base = [product("A-1", "A", 1000), product("KEEP-1", "Masih ada", 900)];
  const master = new Map<string, LiveCatalogRow>([["A-1", row("A-1", "A", 1000)]]);
  const incomplete = reconcileCatalog(base, master, { mode: "master", complete: false, pruneOn: true, pruneMin: 1, buildProduct: build });
  ok("kasus 3a: master tidak lengkap → tidak menghapus", incomplete.removed === 0 && incomplete.products.length === 2, `removed=${incomplete.removed}`);

  const belowMin = reconcileCatalog(base, master, { mode: "master", complete: true, pruneOn: true, pruneMin: 3000, buildProduct: build });
  ok("kasus 3b: master < pruneMin → tidak menghapus", belowMin.removed === 0 && belowMin.products.length === 2, `removed=${belowMin.removed}`);

  const fallback = reconcileCatalog(base, master, { mode: "products", complete: true, pruneOn: true, pruneMin: 1, buildProduct: build });
  ok("kasus 3c: mode fallback products → tidak menambah/menghapus", fallback.added === 0 && fallback.removed === 0);
}

/* ------------------------------------------------------------------ *
 * Kasus 4 — perubahan tipe: satuan → bundle (materialCode harus null)
 * ------------------------------------------------------------------ */
{
  const base = [product("A-1", "A", 1000)];
  const master = new Map<string, LiveCatalogRow>([
    ["A-1", row("A-1", "A", 1000, { bundle: true, components: [{ component_sku: "X-1", multiplier_qty: 3 }] })],
  ]);
  const r = reconcileCatalog(base, master, { mode: "master", complete: true, pruneOn: true, pruneMin: 1, buildProduct: build });
  const p = r.products[0];
  ok("kasus 4: satuan→bundle ikut master", p.isBundle && p.kind === "BUNDLE" && p.materialCode === null && p.components[0].multiplierQty === 3, `updated=${r.updated}`);
}

/* ------------------------------------------------------------------ *
 * Kasus 5 — idempoten: rekonsiliasi kedua tidak menghasilkan perubahan
 * ------------------------------------------------------------------ */
{
  const base = [product("A-1", "A", 1000)];
  const master = new Map<string, LiveCatalogRow>([["A-1", row("A-1", "A", 1000)]]);
  const r1 = reconcileCatalog(base, master, { mode: "master", complete: true, pruneOn: true, pruneMin: 1, buildProduct: build });
  const r2 = reconcileCatalog(r1.products, master, { mode: "master", complete: true, pruneOn: true, pruneMin: 1, buildProduct: build });
  ok("kasus 5: rekonsiliasi idempoten", r2.updated === 0 && r2.added === 0 && r2.removed === 0);
}

/* ------------------------------------------------------------------ *
 * Kasus 6 — sinkronisasi stok fallback dari baris master
 * ------------------------------------------------------------------ */
{
  const p = product("A-1", "A", 1000);
  syncProductFromMaster(p, row("A-1", "A", 1000, { stock: 4321 }));
  ok("kasus 6: stock_available master dipakai sebagai cadangan", p.stockOnHand === 4321, `stock=${p.stockOnHand}`);
}

console.log(failed === 0 ? "\nRESULT: ALL PASS" : `\nRESULT: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);