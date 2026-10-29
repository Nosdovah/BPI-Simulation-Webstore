/**
 * Segmen produk. Sebelumnya union tetap (MEN/WOMEN/UNISEX) karena katalog
 * dibangkitkan dari daftar wangi hardcoded. Sekarang nilainya berasal dari
 * master data ERP (dipakai: brand), jadi bertipe string.
 */
export type Gender = string;

/**
 * Koleksi produk. Diturunkan dari `item_type` master data ERP
 * (`PREBUILT` → `prebuilt`, `BARE_BONE` → `bare-bone`, …), bukan daftar tetap.
 */
export type CollectionSlug = string;

export type WarehouseStock = {
  warehouseId: number;
  warehouseName: string;
  available: number;
  reserved: number;
};

export type BundleComponent = {
  sku: string;
  materialCode: string;
  name: string;
  multiplierQty: number;
  componentStock: number;
};

export type Product = {
  id: number;
  sku: string;
  slug: string;
  name: string;
  scent: string;
  gender: Gender;
  collection: CollectionSlug;
  sizeLabel: string;
  sizeMl: number;
  kind: "EDP" | "EXTRAIT" | "BUNDLE";
  priceIdr: number;
  compareAtIdr: number | null;
  imageKey: string;
  isBundle: boolean;
  materialCode: string | null;
  components: Array<{ materialCode: string; multiplierQty: number }>;
  /** Stok on-hand dari ERP (`stock_available`) — angka AS-IS, apa adanya. */
  stockOnHand: number;
  /** Stok hasil hitung BOM MIN(⌊stok komponen / multiplier⌋) — angka TO-BE. */
  stockToBe: number;
  /** `stock_as_is − stock_to_be`; negatif = oversell, positif = understate. */
  phantom: number;
  stockPerWarehouse: WarehouseStock[];
  notes: { top: string[]; heart: string[]; base: string[] };
  description: string;
};

export type ProductCard = {
  id: number;
  sku: string;
  slug: string;
  name: string;
  gender: Gender;
  collection: CollectionSlug;
  priceIdr: number;
  compareAtIdr: number | null;
  imageKey: string;
  isBundle: boolean;
  sizeLabel: string;
  stockDisplay: number | null;
  stockLabel: string | null;
  stockAware: boolean;
  stockError: string | null;
};

export type ProductDetail = ProductCard & {
  description: string;
  notes: { top: string[]; heart: string[]; base: string[] };
  sizeMl: number;
  bundleComponents: BundleComponent[];
  stockPerWarehouse: WarehouseStock[];
};

export type CartLine = { sku: string; qty: number };

export type OrderItem = {
  sku: string;
  name: string;
  qty: number;
  priceIdr: number;
};

/** Sepuluh status baku ERP (replika Perpack) — huruf besar untuk tampilan. */
export type OrderStatus =
  | "PAID"
  | "PROCESS"
  | "PICKING"
  | "PACKING"
  | "PACKED"
  | "READY_TO_PICKUP"
  | "SENT"
  | "COMPLETED"
  | "CANCELLED"
  | "RETURNED";

/**
 * Jejak integrasi Jalur B (Webstore → Modul 4.2 Order & Status di ERP).
 *
 * `status` di sini adalah salinan terakhir yang diterima dari ERP; sumber
 * kebenarannya tetap ERP. `rawStatus` disimpan apa adanya supaya bisa diaudit
 * saat enum ERP berubah.
 */
export type ErpLink = {
  contract: "perpack-replica" | "none";
  orderRef: string;
  erpId: number | null;
  status: OrderStatus | null;
  rawStatus: string | null;
  trackingNo: string | null;
  pushedAt: number | null;
  lastSyncAt: number | null;
  lastSyncSource: "push" | "poll" | "webhook" | null;
  error: string | null;
};

export type Order = {
  ref: string;
  wmsOrderId: string;
  createdAt: number;
  channel: "WEBSTORE";
  customer: { name: string; phone: string; email: string };
  shipping: {
    address: string;
    city: string;
    postalCode: string;
    courier: string;
    service: string;
    costIdr: number;
  };
  items: OrderItem[];
  subtotalIdr: number;
  totalIdr: number;
  status: OrderStatus;
  trackingNo: string | null;
  actorLast: "SYSTEM" | "STAFF";
  note: string | null;
  /** Null = order tidak (belum) terhubung ke ERP. */
  erp: ErpLink | null;
};