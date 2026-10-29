import type {
  ErpOrderConfig,
  PushOrderResult,
  ErpOrderLookup,
  ErpWebhookEvent,
} from "./types";

export declare const ERP_ORDER_PATHS: Record<string, string>;
export declare const WEBSTORE_CHANNEL_ID: number;
export declare const CHANNEL_NAME: string;
export declare const ERP_STATUSES: string[];
export declare const ERP_FORWARD_FLOW: string[];
export declare const CANONICAL_STATUSES: string[];

export declare function normalizeErpStatus(raw: unknown): string | null;
export declare function mapErpStatus(raw: unknown): string | null;
export declare function parseErpTimestamp(value: unknown): number | null;

export declare function resolveErpOrderConfig(env?: NodeJS.ProcessEnv): ErpOrderConfig;

export declare function pushOrder(
  cfg: ErpOrderConfig,
  order: {
    ref: string;
    totalIdr: number;
    customer?: { name?: string; phone?: string; email?: string };
    items: Array<{ sku: string; qty: number; priceIdr: number }>;
  },
): Promise<PushOrderResult>;

export declare function fetchErpOrder(
  cfg: ErpOrderConfig,
  ref: string,
  opts?: { length?: number },
): Promise<ErpOrderLookup>;

export declare function listErpOrders(
  cfg: ErpOrderConfig,
  opts?: { status?: string; channelId?: number; page?: number; length?: number; search?: string },
): Promise<{ rows: Array<Record<string, unknown>>; metadata: Record<string, unknown> | null }>;

export declare function listWebhookEvents(
  cfg: ErpOrderConfig,
  opts?: { limit?: number },
): Promise<ErpWebhookEvent[]>;

export declare function updateErpOrderStatus(
  cfg: ErpOrderConfig,
  ref: string,
  status: string,
  opts?: { trackingNo?: string; eventId?: string },
): Promise<{
  ok: boolean;
  applied?: boolean;
  status?: string;
  rawStatus?: string;
  effect?: unknown;
  error?: string;
  raw?: unknown;
}>;

export declare function pushStockUpdated(
  cfg: ErpOrderConfig,
  materialCode: string,
  delta: number,
  opts?: { eventId?: string },
): Promise<{ ok: boolean; applied?: boolean; effect?: unknown; error?: string; raw?: unknown }>;

export declare function fetchErpStock(
  cfg: ErpOrderConfig,
  sku: string,
): Promise<{
  sku: string;
  isBundle?: boolean;
  available: number | null;
  stockAsIs?: number;
  phantom?: number;
  stocks?: Array<{ warehouseId: number; warehouseName: string; available: number }>;
  components?: Array<{ component_sku: string; multiplier: number; stock: number }>;
  found?: boolean;
  error?: string;
  raw?: unknown;
}>;

export declare function resolveErpConfig(env?: NodeJS.ProcessEnv): {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  retries: number;
  warehouseStock: boolean;
};
export declare const DEFAULT_BASE_URL: string;
