import type { ErpSnapshot, ErpIntegrity } from "./types";

export declare const DEFAULT_BASE_URL: string;
export declare const ERP_ENDPOINTS: Record<string, string>;

export declare function resolveErpConfig(env?: NodeJS.ProcessEnv): {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  retries: number;
};

export declare function checkIntegrity(data: ErpSnapshot["data"]): ErpIntegrity;

export declare function pullSnapshot(env?: NodeJS.ProcessEnv): Promise<ErpSnapshot>;