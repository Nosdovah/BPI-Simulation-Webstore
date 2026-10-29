/** DTO mentah dari API ERP (MOAI SCM-ERP v2). Tidak ada nilai default di sini. */

export type ErpProduct = {
  id?: string;
  sku: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  item_type?: string | null;
  specs?: string | null;
  stock?: number | null;
  bin_code?: string | null;
  uom?: string | null;
  cost_price?: number | null;
  unit_price?: number | null;
  retail_usd?: number | null;
  wholesale_price?: number | null;
  warranty?: string | null;
  is_assembly?: boolean | null;
  is_serial?: boolean | null;
};

export type ErpBalance = {
  sku: string;
  stock_on_hand?: number | null;
  allocated?: number | null;
  available?: number | null;
  bin_code?: string | null;
  valuation?: number | null;
};

export type ErpBomComponent = {
  component_sku: string;
  component_name?: string | null;
  qty: number;
  scrap_pct?: number | null;
};

export type ErpBom = {
  target_sku: string;
  target_product_id?: string | null;
  name?: string | null;
  version?: string | null;
  labor_cost?: number | null;
  overhead_cost?: number | null;
  components: ErpBomComponent[];
};

export type ErpWarehouse = {
  id: string;
  code: string;
  name: string;
  type?: string | null;
};

export type ErpOperational = {
  sku?: string;
  product_id?: string;
  min_stock?: number | null;
  max_stock?: number | null;
  reorder_point?: number | null;
  safety_stock?: number | null;
  is_fast_moving?: boolean | null;
};

export type ErpBundleStock = {
  bundle_sku: string;
  quota_static: number;
  stock_from_components: number | null;
  bom_available?: boolean;
};

export type ErpIntegrity = {
  duplicate_skus: string[];
  orphan_boms: Array<{
    target_sku: string;
    missing_target: boolean;
    missing_components: string[];
  }>;
  missing_price: string[];
  negative_stock: string[];
  warehouse_breakdown_available: boolean;
  /* ---- v2: phantom gate (pull.mjs) ---------------------------------- */
  bundle_stock_available: boolean;
  phantom_bundles: Array<{
    bundle_sku: string;
    quota_static: number;
    stock_from_components: number;
    phantom_units: number;
  }>;
  phantom_exposure_units: number;
  phantom_uncomputable: string[];
};

export type ErpSnapshotData = {
  products: ErpProduct[];
  balances: ErpBalance[];
  boms: ErpBom[];
  warehouses: ErpWarehouse[];
  operational: ErpOperational[];
  bundle_stock: ErpBundleStock[];
};

export type ErpSnapshot = {
  version: 1;
  fetched_at: string;
  source: { base_url: string; endpoints: Record<string, string> };
  counts: {
    products: number;
    balances: number;
    boms: number;
    warehouses: number;
    operational: number;
    bundle_stock: number;
  };
  integrity: ErpIntegrity;
  bundle_stock_error: string | null;
  checksum: string;
  data: ErpSnapshotData;
};

/* ------------------------------------------------------------------ */
/* Jalur B — kontrak order (lib/erp/order.mjs)                         */
/* ------------------------------------------------------------------ */

export type ErpOrderContractFamily = "engine-v1" | "blueprint-v02" | "none";

export type ErpOrderConfig = {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  retries: number;
  mode: "push" | "off";
  strict: boolean;
  sync: boolean;
  stockOverlay: "local" | "webhook";
  statusTtlMs: number;
};

export type PushOrderResult = {
  ok: boolean;
  contract?: ErpOrderContractFamily;
  httpStatus?: number | null;
  erpId?: number | null;
  erpOrderRef?: string;
  /** Enum baku storefront (huruf besar). */
  status?: string;
  rawStatus?: string | null;
  note?: string | null;
  raw?: unknown;
  error?: string;
};

export type ErpOrderLookup = {
  ok: boolean;
  found: boolean;
  ref: string;
  erpId?: number | null;
  rawStatus?: string | null;
  /** Enum baku storefront (huruf besar). */
  status?: string | null;
  trackingNo?: string | null;
  courier?: string | null;
  actorLast?: string | null;
  totalIdr?: number | null;
  duplicates?: number;
  total?: number;
  raw?: unknown;
  error?: string;
};