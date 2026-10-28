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
};

export type ErpSnapshotData = {
  products: ErpProduct[];
  balances: ErpBalance[];
  boms: ErpBom[];
  warehouses: ErpWarehouse[];
  operational: ErpOperational[];
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
  };
  integrity: ErpIntegrity;
  checksum: string;
  data: ErpSnapshotData;
};