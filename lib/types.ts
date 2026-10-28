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
  /** Stok on-hand dari sistem inventori ERP untuk SKU satuan / komponen. */
  stockOnHand: number;
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

/** Sepuluh tahap status baku. Tidak ada enum liar di luar daftar ini. */
export type OrderStatus =
  | "PAID"
  | "PROCESSING"
  | "PICKING"
  | "PACKED"
  | "HANDOVER_TO_COURIER"
  | "IN_TRANSIT"
  | "ARRIVED_AT_HUB"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "COMPLETED";

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
};