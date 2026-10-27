import type { Mode, Product } from "./types";
import { getSold } from "./state";

export type ResolvedStock = {
  value: number | null;
  label: string | null;
  aware: boolean;
  error: string | null;
  /** true kalau angka ini dihitung dari komponen, bukan kuota manual */
  computed: boolean;
};

/** Stok komponen mentah (materialCode -> unit tersedia), sudah dikurangi penjualan. */
export type ComponentStockMap = Map<string, number>;

/**
 * Satu-satunya tempat logika tampilan stok hidup di sisi UI.
 * Aturan blueprint §5.4:
 *  - baseline : tampilkan kuota manual WMS apa adanya, tanpa interpretasi
 *  - tobe     : bundle dihitung dari komponen pembatas, fail loud kalau kosong
 */
export function resolveStockDisplay(
  p: Product,
  mode: Mode,
  componentStocks: ComponentStockMap,
): ResolvedStock {
  if (mode === "baseline") {
    return {
      value: p.baselineQuota,
      label: null,
      aware: false,
      error: null,
      computed: false,
    };
  }

  if (!p.isBundle) {
    const sold = p.materialCode ? getSold(p.materialCode) : 0;
    return {
      value: Math.max(0, p.baselineQuota - sold),
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
    label: `Bundling ${p.components.length} botol`,
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