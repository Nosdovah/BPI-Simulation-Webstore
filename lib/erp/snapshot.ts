import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ErpSnapshot } from "./types";

/**
 * Pembaca snapshot ERP.
 *
 * Webstore TIDAK memanggil ERP di request path (kecuali `OSR_CATALOG_SOURCE=live`).
 * Data diambil sekali oleh `npm run erp:sync` lalu disimpan sebagai snapshot
 * ber-checksum. Ini menjaga dua hal sekaligus:
 *   1. tidak ada data hardcoded — semuanya berasal dari ERP;
 *   2. hasil run baseline vs to-be tetap deterministik (snapshot yang sama).
 */

export const DEFAULT_SNAPSHOT_PATH = join(
  process.cwd(),
  ".data",
  "erp",
  "catalog.snapshot.json",
);

export class ErpDataUnavailableError extends Error {
  readonly snapshotPath: string;
  constructor(message: string, snapshotPath: string) {
    super(message);
    this.name = "ErpDataUnavailableError";
    this.snapshotPath = snapshotPath;
  }
}

export function snapshotPath(): string {
  return process.env.OSR_ERP_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH;
}

let cache: { mtimeMs: number; snapshot: ErpSnapshot } | null = null;

export function readSnapshot(): ErpSnapshot {
  const file = snapshotPath();

  if (!existsSync(file)) {
    throw new ErpDataUnavailableError(
      `Snapshot master data ERP tidak ditemukan di ${file}. ` +
        `Jalankan \`npm run erp:sync\` (butuh OSR_ERP_BASE_URL + OSR_ERP_TOKEN) ` +
        `atau set OSR_CATALOG_SOURCE=live untuk menarik langsung dari ERP.`,
      file,
    );
  }

  const { mtimeMs } = statSync(file);
  if (cache && cache.mtimeMs === mtimeMs) return cache.snapshot;

  let parsed: ErpSnapshot;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as ErpSnapshot;
  } catch (err) {
    throw new ErpDataUnavailableError(
      `Snapshot ERP di ${file} rusak / bukan JSON valid: ${(err as Error).message}. ` +
        `Hapus lalu jalankan ulang \`npm run erp:sync\`.`,
      file,
    );
  }

  if (!parsed?.data?.products?.length) {
    throw new ErpDataUnavailableError(
      `Snapshot ERP di ${file} tidak berisi produk. Jalankan ulang \`npm run erp:sync\`.`,
      file,
    );
  }

  cache = { mtimeMs, snapshot: parsed };
  return parsed;
}

export function readSnapshotIfPresent(): ErpSnapshot | null {
  try {
    return readSnapshot();
  } catch {
    return null;
  }
}