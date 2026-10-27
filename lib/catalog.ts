import type {
  CollectionSlug,
  Gender,
  Product,
  WarehouseStock,
} from "./types";

/* ------------------------------------------------------------------ *
 * Generator katalog deterministik.
 * 176 single SKU + 3.520 bundle SKU = 3.696 varian (sesuai BLUEPRINT).
 * Seed tetap 20260918 supaya angka sama setiap build & setiap request.
 * ------------------------------------------------------------------ */

const SEED = 20260918;

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ScentDef = {
  name: string;
  code: string;
  gender: Gender;
  collection: CollectionSlug;
};

const SCENTS: ScentDef[] = [
  { name: "Sanctum Arcanum", code: "SANCTUM", gender: "UNISEX", collection: "signature" },
  { name: "Noctis Obscura", code: "NOCTIS", gender: "UNISEX", collection: "noir" },
  { name: "Elixir Homme", code: "ELIXIR-HOMME", gender: "MEN", collection: "signature" },
  { name: "Elixir One", code: "ELIXIR-ONE", gender: "MEN", collection: "signature" },
  { name: "Boujee Fluff", code: "BOUJEE", gender: "WOMEN", collection: "signature" },
  { name: "Numayr", code: "NUMAYR", gender: "UNISEX", collection: "kadam-sidik" },
  { name: "Arwa Liliya", code: "ARWA", gender: "WOMEN", collection: "kadam-sidik" },
  { name: "Dawn", code: "DAWN", gender: "UNISEX", collection: "dust-la-stella" },
  { name: "Dusk", code: "DUSK", gender: "UNISEX", collection: "dust-la-stella" },
  { name: "One Million Lucky", code: "LUCKY-1M", gender: "MEN", collection: "noir" },
  { name: "Queen of Maroco", code: "MAROCO", gender: "WOMEN", collection: "noir" },
  { name: "Velour Nocturne", code: "VELOUR", gender: "UNISEX", collection: "noir" },
  { name: "Amber Reverie", code: "AMBER", gender: "WOMEN", collection: "signature" },
  { name: "Cedar Monolith", code: "CEDAR", gender: "MEN", collection: "signature" },
  { name: "Iris Cipher", code: "IRIS", gender: "UNISEX", collection: "noir" },
  { name: "Saffron Veil", code: "SAFFRON", gender: "WOMEN", collection: "dust-la-stella" },
  { name: "Oud Meridian", code: "OUD", gender: "MEN", collection: "kadam-sidik" },
  { name: "Musk Archive", code: "MUSK", gender: "UNISEX", collection: "signature" },
  { name: "Vetiver Static", code: "VETIVER", gender: "MEN", collection: "noir" },
  { name: "Neroli Drift", code: "NEROLI", gender: "WOMEN", collection: "dust-la-stella" },
  { name: "Tonka Bloom", code: "TONKA", gender: "WOMEN", collection: "signature" },
  { name: "Leather Requiem", code: "LEATHER", gender: "MEN", collection: "noir" },
  { name: "Fig & Frost", code: "FIG", gender: "UNISEX", collection: "dust-la-stella" },
  { name: "Salt Petal", code: "SALT PETAL", gender: "WOMEN", collection: "dust-la-stella" },
  { name: "Cardamom Line", code: "CARDAMOM", gender: "MEN", collection: "signature" },
  { name: "Tuberose Static", code: "TUBEROSE", gender: "WOMEN", collection: "noir" },
  { name: "Incense Grid", code: "INCENSE", gender: "UNISEX", collection: "kadam-sidik" },
  { name: "Bergamot Fold", code: "BERGAMOT", gender: "UNISEX", collection: "signature" },
  { name: "Cacao Rite", code: "CACAO", gender: "MEN", collection: "noir" },
  { name: "Peony Signal", code: "PEONY", gender: "WOMEN", collection: "signature" },
  { name: "Sandal Ember", code: "SANDAL", gender: "UNISEX", collection: "kadam-sidik" },
  { name: "Rum & Resin", code: "RUM", gender: "MEN", collection: "dust-la-stella" },
  { name: "Moonlit Linen", code: "LINEN", gender: "WOMEN", collection: "dust-la-stella" },
  { name: "Juniper Phase", code: "JUNIPER", gender: "MEN", collection: "signature" },
  { name: "Violet Index", code: "VIOLET", gender: "WOMEN", collection: "noir" },
  { name: "Tobacco Ledger", code: "TOBACCO", gender: "MEN", collection: "kadam-sidik" },
  { name: "Coconut Static", code: "COCONUT", gender: "WOMEN", collection: "dust-la-stella" },
  { name: "Ginger Protocol", code: "GINGER", gender: "UNISEX", collection: "signature" },
  { name: "White Tea Code", code: "WHITE-TEA", gender: "UNISEX", collection: "noir" },
  { name: "Rose Monogram", code: "ROSE", gender: "WOMEN", collection: "kadam-sidik" },
  { name: "Patchouli Signal", code: "PATCHOULI", gender: "MEN", collection: "noir" },
  { name: "Ylang Meridian", code: "YLANG", gender: "WOMEN", collection: "kadam-sidik" },
  { name: "Absinthe Hour", code: "ABSINTHE", gender: "UNISEX", collection: "noir" },
  { name: "Santal Drift", code: "SANTAL", gender: "UNISEX", collection: "dust-la-stella" },
];

const SIZES = [
  { code: "20ML", ml: 20, label: "20ml", base: 34000, span: 45000 },
  { code: "60ML", ml: 60, label: "60ml", base: 99000, span: 50000 },
  { code: "100ML", ml: 100, label: "100ml", base: 149000, span: 40000 },
  { code: "EXT50", ml: 50, label: "Extrait 50ml", base: 189000, span: 0 },
] as const;

const WAREHOUSES = [
  { warehouseId: 1, warehouseName: "Warehouse Bogor" },
  { warehouseId: 2, warehouseName: "Warehouse Cikarang" },
];

const NOTE_TOP = ["Bergamot", "Lemon Zest", "Pink Pepper", "Sea Salt", "Cardamom", "Green Fig"];
const NOTE_HEART = ["Jasmine", "Iris", "Lavender", "Rose Absolute", "Neroli", "Violet Leaf"];
const NOTE_BASE = ["Amber", "Cedarwood", "Musk", "Vetiver", "Tonka Bean", "Sandalwood"];

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function roundTo(n: number, step = 1000) {
  return Math.round(n / step) * step;
}

function buildWarehouseStock(total: number, rng: () => number): WarehouseStock[] {
  const split = 0.55 + rng() * 0.3;
  const bogor = Math.floor(total * split);
  const cikarang = total - bogor;
  return [
    { ...WAREHOUSES[0], available: bogor, reserved: 0 },
    { ...WAREHOUSES[1], available: cikarang, reserved: 0 },
  ];
}

function buildCatalog(): Product[] {
  const rng = mulberry32(SEED);
  const products: Product[] = [];

  // ---------- 1. Single SKU : 44 scent x 4 size = 176 ----------
  const singlesByMaterial = new Map<string, Product>();

  SCENTS.forEach((scent, sIdx) => {
    SIZES.forEach((size, zIdx) => {
      const price = size.span === 0 ? size.base : roundTo(size.base + rng() * size.span);
      // Material code: dua SKU penting punya kode tetap sesuai paper
      let materialCode = `M${2300 + sIdx * 10 + zIdx}`;
      if (scent.code === "SANCTUM" && size.code === "20ML") materialCode = "M2291";
      if (scent.code === "NOCTIS" && size.code === "20ML") materialCode = "M2292";

      let stock: number;
      if (materialCode === "M2291") stock = 11927; // angka tetap paper
      else if (materialCode === "M2292") stock = 10932; // angka tetap paper
      else stock = Math.floor(rng() * 14500);

      const sku = `${scent.code}-${size.code}`;
      const notes = {
        top: [NOTE_TOP[Math.floor(rng() * NOTE_TOP.length)], NOTE_TOP[Math.floor(rng() * NOTE_TOP.length)]],
        heart: [NOTE_HEART[Math.floor(rng() * NOTE_HEART.length)]],
        base: [NOTE_BASE[Math.floor(rng() * NOTE_BASE.length)], NOTE_BASE[Math.floor(rng() * NOTE_BASE.length)]],
      };

      const product: Product = {
        id: products.length + 1,
        sku,
        slug: slugify(sku),
        name: `Octarine — ${scent.name} ${size.label} Eau de Parfum`,
        scent: scent.name,
        gender: scent.gender,
        collection: scent.collection,
        sizeLabel: size.label,
        sizeMl: size.ml,
        kind: "EDP",
        priceIdr: price,
        compareAtIdr: rng() < 0.25 ? roundTo(price * 1.25) : null,
        imageKey: `${scent.code}-${size.code}`,
        isBundle: false,
        materialCode,
        components: [],
        baselineQuota: stock,
        stockPerWarehouse: buildWarehouseStock(stock, rng),
        notes,
        description:
          `Komposisi ${scent.name} dari koleksi ${scent.collection.replace(/-/g, " ")}. ` +
          `Dibuka dengan ${notes.top.join(" dan ")}, jantung ${notes.heart.join(", ")}, ` +
          `ditutup ${notes.base.join(" dan ")}. Varian ${size.label} untuk pemakaian harian.`,
      };
      products.push(product);
      singlesByMaterial.set(materialCode, product);
    });
  });

  const singles = [...products];
  const componentPool = singles.filter((p) => p.sizeMl === 20);

  // ---------- 2. Bundle SKU : 3.520 ----------
  const BUNDLE_TOTAL = 3520;

  for (let i = 0; i < BUNDLE_TOTAL; i++) {
    let components: Array<{ materialCode: string; multiplierQty: number }>;
    let sku: string;
    let name: string;
    let baseQuotaOverride: number | null = null;

    if (i === 0) {
      // Flagship bundle yang dipakai sebagai bukti di paper
      components = [
        { materialCode: "M2291", multiplierQty: 1 },
        { materialCode: "M2292", multiplierQty: 1 },
      ];
      sku = "SANCTUM-NOCTIS-20ML-A1";
      name = "Octarine — Bundling Sanctum Arcanum + Noctis Obscura 20ml";
      baseQuotaOverride = 10932; // kuota manual WMS 4.1 — tidak pernah dihitung ulang
    } else if (i === 1) {
      components = [
        { materialCode: "M2340", multiplierQty: 2 },
        { materialCode: "M2341", multiplierQty: 1 },
      ];
      sku = "BOUJEE-FLUFF-2BTL";
      name = "Octarine — Bundling Boujee Fluff 2 Botol 20ml";
    } else {
      const count = 2 + Math.floor(rng() * 4); // 2..5 komponen
      const picked: Array<{ materialCode: string; multiplierQty: number }> = [];
      for (let c = 0; c < count; c++) {
        const comp = componentPool[Math.floor(rng() * componentPool.length)];
        if (picked.some((p) => p.materialCode === comp.materialCode)) continue;
        picked.push({
          materialCode: comp.materialCode as string,
          multiplierQty: rng() < 0.15 ? 2 : 1,
        });
      }
      if (picked.length < 2) {
        picked.push({ materialCode: "M2291", multiplierQty: 1 });
      }
      components = picked;
      const shortNames = components.map((c) => {
        const p = singlesByMaterial.get(c.materialCode)!;
        return p.scent.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8);
      });
      sku = `${shortNames.join("-")}-20ML-${String(i).padStart(4, "0")}`;
      name = `Octarine — Bundling ${components
        .map((c) => singlesByMaterial.get(c.materialCode)?.scent ?? c.materialCode)
        .join(" + ")} 20ml`;
    }

    const compDetails = components.map((c) => singlesByMaterial.get(c.materialCode)!);
    const rawSum = compDetails.reduce(
      (acc, p, idx) => acc + p.priceIdr * components[idx].multiplierQty,
      0,
    );
    const discount = 0.1 + rng() * 0.12;
    const price = roundTo(rawSum * (1 - discount));

    // Kapasitas sebenarnya = MIN(floor(stok komponen / multiplier))
    const capacity = Math.min(
      ...compDetails.map((p, idx) =>
        Math.floor(p.baselineQuota / components[idx].multiplierQty),
      ),
    );

    // Kuota baseline: angka manual, kadang lebih tinggi dari kapasitas nyata
    let baselineQuota = capacity;
    if (baseQuotaOverride !== null) {
      baselineQuota = baseQuotaOverride;
    } else if (rng() < 0.42) {
      baselineQuota = Math.round(capacity * (1.04 + rng() * 0.09));
    }

    products.push({
      id: products.length + 1,
      sku,
      slug: slugify(sku),
      name,
      scent: compDetails[0].scent,
      gender: compDetails[0].gender,
      collection: compDetails[0].collection,
      sizeLabel: `Bundling ${components.length} botol`,
      sizeMl: 20 * components.reduce((a, c) => a + c.multiplierQty, 0),
      kind: "BUNDLE",
      priceIdr: price,
      compareAtIdr: roundTo(rawSum),
      imageKey: `BUNDLE-${i}`,
      isBundle: true,
      materialCode: null,
      components,
      baselineQuota: Math.max(0, baselineQuota),
      stockPerWarehouse: [],
      notes: compDetails[0].notes,
      description:
        `Paket bundling berisi ${components.length} varian: ` +
        compDetails
          .map((p, idx) => `${p.scent} 20ml x${components[idx].multiplierQty}`)
          .join(", ") +
        ". Stok paket mengikuti komponen pembatas.",
    });
  }

  return products;
}

/* ---------------- cache per proses ---------------- */

let cached: Product[] | null = null;
let cachedBySku: Map<string, Product> | null = null;
let cachedById: Map<number, Product> | null = null;
let cachedBySlug: Map<string, Product> | null = null;
let cachedByMaterial: Map<string, Product> | null = null;

export function getCatalog(): Product[] {
  if (!cached) cached = buildCatalog();
  return cached;
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
    bySku: cachedBySku!,
    byId: cachedById!,
    bySlug: cachedBySlug!,
    byMaterial: cachedByMaterial!,
  };
}

/** Cari SKU single berdasarkan kode material WMS (M2291, M2292, …). */
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

export function allScentNames() {
  return SCENTS.map((s) => s.name);
}

export const COLLECTIONS: Array<{
  slug: CollectionSlug;
  title: string;
  subtitle: string;
}> = [
  { slug: "signature", title: "Signature", subtitle: "Koleksi inti Octarine" },
  { slug: "noir", title: "Noir", subtitle: "Arah gelap, resin, dan tembakau" },
  { slug: "dust-la-stella", title: "Dust La Stella", subtitle: "Kolaborasi Dawn & Dusk" },
  { slug: "kadam-sidik", title: "Kadam Sidik", subtitle: "Kolaborasi Numayr & Arwa Liliya" },
];

export const CATALOG_TOTAL = 3696;