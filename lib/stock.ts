import type { Product } from "./types";
import { getSold } from "./state";

export type ResolvedStock = {
  value: number | null;
  label: string | null;
  aware: boolean;
  error: string | null;
  /** true kalau angka ini dihitung dari komponen, bukan stok SKU itu sendiri */
  computed: boolean;
};

/** Stok komponen mentah (materialCode -> unit tersedia), sudah dikurangi penjualan. */
export type ComponentStockMap = Map<string, number>;

/**
 * Mode tampilan stok bundling:
 *
 *   as-is (default) → angka `stock_available` dari ERP apa adanya. Ini yang
 *                     dilihat pelanggan di replika Perpack, termasuk kalau
 *                     angkanya lebih besar dari kapasitas komponen (phantom).
 *   to-be           → hitung MIN(⌊stok komponen / multiplier⌋), sama dengan
 *                     `/api/to-be/bundle-stock`. Dipakai saat simulasi
 *                     perbaikan BOM (TO-BE) di paper DMAIC.
 */
export type StockMode = "as-is" | "to-be";

export function stockMode(env = process.env): StockMode {
  return String(env.OSR_STOCK_MODE ?? "as-is").toLowerCase() === "to-be" ? "to-be" : "as-is";
}

/**
 * Satu-satunya tempat logika tampilan stok hidup di sisi UI.
 *
 *  - SKU satuan  : stok `stock_available` dikurangi penjualan sesi
 *  - SKU rakitan : AS-IS = angka ERP; TO-BE = komponen pembatas (BOM MIN)
 */
export function resolveStockDisplay(
  p: Product,
  componentStocks: ComponentStockMap,
  mode: StockMode = stockMode(),
): ResolvedStock {
  if (!p.isBundle) {
    const sold = p.materialCode ? getSold(p.materialCode) : 0;
    return {
      value: Math.max(0, p.stockOnHand - sold),
      label: null,
      aware: false,
      error: null,
      computed: false,
    };
  }

  if (p.components.length === 0) {
    return {
      value: null,
      label: null,
      aware: true,
      error: "Data komposisi tidak tersedia",
      computed: false,
    };
  }

  if (mode === "as-is") {
    const sold = getSold(p.sku);
    return {
      value: Math.max(0, p.stockOnHand - sold),
      label:
        p.phantom !== 0
          ? `Stok ERP AS-IS (BOM ${p.stockToBe}, selisih ${p.phantom > 0 ? "+" : ""}${p.phantom})`
          : `Stok ERP AS-IS · ${p.components.length} komponen`,
      aware: true,
      error: null,
      computed: false,
    };
  }

  const perComponent = p.components.map((c) => {
    const stock = componentStocks.get(c.materialCode) ?? 0;
    return {
      stock,
      multiplierQty: c.multiplierQty,
      capacity: Math.floor(stock / c.multiplierQty),
    };
  });

  const bottleneck = perComponent.reduce((min, c) =>
    c.capacity < min.capacity ? c : min,
  );

  return {
    value: Math.max(0, bottleneck.capacity),
    label: `BOM MIN ${p.components.length} komponen`,
    aware: true,
    error: null,
    computed: true,
  };
}

/** Versi murni yang dipakai core setelah stok komponen diketahui. */
export function resolveBundleStock(
  components: Array<{ componentStock: number; multiplierQty: number }>,
): number {
  if (components.length === 0) return 0;
  return Math.max(
    0,
    Math.min(
      ...components.map((c) => Math.floor(c.componentStock / c.multiplierQty)),
    ),
  );
}