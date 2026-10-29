import type { ErpSnapshot, ErpIntegrity, ErpEnvelope } from "./types";

export declare const DEFAULT_BASE_URL: string;
export declare const ERP_ENDPOINTS: Record<string, string>;
export declare const PAGE_LIMIT: { catalog: number; groups: number; bundleStock: number };

export declare function resolveErpConfig(env?: NodeJS.ProcessEnv): {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  retries: number;
  warehouseStock: boolean;
};

export declare function unwrap<T = unknown>(json: unknown, path: string): ErpEnvelope<T>;
export declare function getJson<T = unknown>(
  cfg: { baseUrl: string; token?: string; timeoutMs?: number; retries?: number },
  path: string,
): Promise<ErpEnvelope<T>>;
export declare function postJson<T = unknown>(
  cfg: { baseUrl: string; token?: string; timeoutMs?: number; retries?: number },
  path: string,
  body: unknown,
): Promise<ErpEnvelope<T>>;

export declare function fetchAll<T = Record<string, unknown>>(
  cfg: { baseUrl: string; token?: string; timeoutMs?: number; retries?: number },
  path: string,
  opts?: { length?: number; maxPages?: number },
): Promise<{
  rows: T[];
  meta: { page: number; length: number; count: number; total_page: number } | null;
  expected: number;
  complete: boolean;
}>;

export declare function checkIntegrity(data: ErpSnapshot["data"]): ErpIntegrity;

export declare function pullSnapshot(env?: NodeJS.ProcessEnv): Promise<ErpSnapshot>;
