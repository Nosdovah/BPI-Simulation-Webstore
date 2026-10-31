/**
 * DTO mentah dari API ERP — replika Perpack (Octarine).
 *
 * Sumber kanonik: `GET /openapi.json` di server ERP + `docs/API_INTEGRATION.md`.
 * Nama field di sini WAJIB sama dengan ERP (`sku`, `sell_price`,
 * `stock_available`, `is_bundle`, `components[].multiplier_qty`, `stocks[].available`).
 * Kalau ada mismatch, yang diubah adalah storefront — bukan ERP.
 *
 * TIDAK ADA nilai default di sini. Semua angka berasal dari respons ERP.
 */

/** Envelope semua endpoint ERP. */
export type ErpEnvelope<T> = {
  code: number;
  msg: { id: string; en: string };
  data: T;
  metadata?: ErpMetadata;
};

export type ErpMetadata = {
  page: number;
  length: number;
  count: number;
  total_page: number;
};

/** Komposisi bundling — `multiplier_qty`, BUKAN `qty`. */
export type ErpComponent = {
  product_id: number;
  component_sku: string;
  multiplier_qty: number;
};

/** Satu baris `GET /api/webhooks/catalog` (flat, sudah termasuk bundling). */
export type ErpCatalogItem = {
  id: number;
  product_group_id: number;
  name: string;
  sku: string;
  sku_code?: string;
  alias?: string;
  sell_price: number;
  purchase_price?: number;
  is_bundle: boolean;
  components: ErpComponent[];
  images?: string[];
  stock_available: number;
};

/** Stok per gudang — `id` di sini adalah id gudang, bukan id stok. */
export type ErpWarehouseStock = {
  warehouse_id: number;
  warehouse_name: string;
  available: number;
  reserved: number;
  on_order: number;
};

/** Satu baris `/v1/products/group/page` → `variants[]`. */
export type ErpVariant = {
  sku: string;
  product_group_id: number;
  variation_label?: string;
  variation_value?: string;
  weight?: number | null;
  type?: string;
  is_bundle: boolean;
  stocks: ErpWarehouseStock[];
};

/** Grup produk (diringkas saat snapshot ditulis — payload asli ±2,4 MB). */
export type ErpGroup = {
  id: number;
  product_group_id: number;
  name: string;
  thumbnail?: string;
  description?: string;
  brand?: string;
  variant_count: number;
};

export type ErpWarehouse = {
  id: number;
  name: string;
  address?: string;
  warehouse_type?: string;
  status?: string;
};

export type ErpChannel = {
  id: number;
  name: string;
  status?: string;
};

/** `GET /api/to-be/bundle-stock` → satu bundle. */
export type ErpBundleStock = {
  sku: string;
  is_bundle: boolean;
  /** stok yang dilaporkan ERP apa adanya (kuota manual) */
  stock_as_is: number;
  /** MIN(⌊stok komponen / multiplier⌋) */
  stock_to_be: number;
  /** stock_as_is − stock_to_be; negatif = oversell, positif = understate */
  phantom: number;
  components: Array<{ component_sku: string; multiplier: number; stock: number }>;
};

export type ErpBundleStockSummary = {
  total_bundles: number;
  oversell: number;
  understate: number;
  matched: number;
};

/** `GET /api/to-be/sales-summary` */
export type ErpSalesSummary = {
  sales_order: Record<string, number>;
  sales_product: Record<string, number>;
  total_orders: number;
};

/**
 * Status order ERP — HURUF KECIL, 10 nilai. Storefront memakai enum yang sama
 * (di-uppercase untuk tampilan) supaya tidak ada penerjemahan yang bisa drift.
 */
export type ErpOrderStatus =
  | "paid"
  | "process"
  | "picking"
  | "packing"
  | "packed"
  | "ready_to_pickup"
  | "sent"
  | "completed"
  | "cancelled"
  | "returned";

/** Satu baris `POST /v1/orders/page` (40 field, kunci = `reference_no`). */
export type ErpOrder = {
  id: number;
  reference_no: string;
  order_at: string;
  created_at: string;
  process_at?: string | null;
  returned_at?: string | null;
  deadline_at?: string | null;
  qty: number;
  amount: number;
  cogs?: number | null;
  shipping_fee?: number | null;
  cod_fee?: number | null;
  courier?: string | null;
  courier_label?: string | null;
  warehouse_name?: string | null;
  channel_name?: string | null;
  customer_username?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  awb?: string | null;
  product_summary?: string | null;
  status: ErpOrderStatus;
  status_mp?: string | null;
  sent_at?: string | null;
  updated_at?: string | null;
};

/** Respons `POST /api/webhooks/purchase-order`. */
export type ErpPurchaseOrderResult = {
  applied: boolean;
  order_id: number;
  reference_no: string;
  status: ErpOrderStatus;
  qty: number;
  amount: number;
  product_summary?: string;
};

/** Satu event di `GET /api/webhooks/wms?limit=`. */
export type ErpWebhookEvent = {
  id: number;
  event_id: string;
  event: string;
  applied: number;
  effect: string;
  received_at: string;
};

export type ErpIntegrity = {
  catalog_count_expected: number;
  catalog_count_actual: number;
  catalog_pagination_complete: boolean;
  duplicate_skus: string[];
  bundles_without_components: string[];
  missing_components: Array<{ sku: string; missing: string[] }>;
  missing_price: string[];
  negative_stock: string[];
  bundle_stock_summary: ErpBundleStockSummary | null;
  warehouse_breakdown_available: boolean;
};

export type ErpSnapshotData = {
  products: ErpCatalogItem[];
  catalogMeta: { count: number; pages: number; complete: boolean };
  variants: ErpVariant[];
  groups: ErpGroup[];
  warehouses: ErpWarehouse[];
  channels: ErpChannel[];
  bundleStock: { summary: ErpBundleStockSummary | null; bundles: ErpBundleStock[] };
  salesSummary: ErpSalesSummary | null;
};

export type ErpSnapshot = {
  version: 2;
  contract: "perpack-replica";
  fetched_at: string;
  elapsed_ms: number;
  source: {
    base_url: string;
    endpoints: Record<string, string>;
    warehouse_stock: boolean;
  };
  counts: {
    products: number;
    variants: number;
    groups: number;
    warehouses: number;
    channels: number;
    bundles: number;
  };
  integrity: ErpIntegrity;
  checksum: string;
  data: ErpSnapshotData;
};

/* ------------------------------------------------------------ Jalur B/4.2 --- */

/** Konfigurasi gateway order (hasil `resolveErpOrderConfig`). */
export type ErpOrderConfig = {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  retries: number;
  warehouseStock: boolean;
  mode: "push" | "off";
  strict: boolean;
  sync: boolean;
  stockOverlay: "webhook" | "local";
  statusTtlMs: number;
  channelId: number;
};

export type PushOrderResult = {
  ok: boolean;
  contract: "perpack-replica";
  httpStatus?: number | null;
  erpId?: number | null;
  erpOrderRef?: string | null;
  /** status storefront (UPPERCASE), hasil pemetaan dari enum ERP */
  status?: string | null;
  /** status mentah ERP (huruf kecil) */
  rawStatus?: string | null;
  applied?: boolean;
  productSummary?: string | null;
  note?: string | null;
  error?: string | null;
  /**
   * Peta `materialCode -> unit` yang SUDAH dikurangi ERP saat purchase-order
   * diterima (`data.stock_deducted.deducted` pada respons ERP).
   *
   * Ada isinya = ERP adalah pemilik pengurangan stok untuk order ini, sehingga
   * storefront TIDAK boleh mengirim `stock.updated` lagi. Kalau dikirim juga,
   * stok turun dua kali (bug yang terverifikasi 31 Okt 2026: jual 2 unit →
   * stok turun 4).
   */
  stockDeducted?: Record<string, number> | null;
  raw?: unknown;
};

export type ErpOrderLookup = {
  ok: boolean;
  found: boolean;
  ref: string;
  erpId?: number | null;
  rawStatus?: string | null;
  status?: string | null;
  trackingNo?: string | null;
  courier?: string | null;
  totalIdr?: number | null;
  qty?: number | null;
  productSummary?: string | null;
  updatedAt?: string | null;
  duplicates?: number;
  error?: string | null;
  raw?: unknown;
};
