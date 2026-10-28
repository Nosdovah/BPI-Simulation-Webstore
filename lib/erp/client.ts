import { pullSnapshot, resolveErpConfig } from "./pull.mjs";
import { readSnapshot, readSnapshotIfPresent, snapshotPath } from "./snapshot";
import type { ErpSnapshot } from "./types";
import type { CatalogMeta } from "./mapper";

/**
 * Titik masuk data ERP untuk runtime storefront.
 *
 *   OSR_CATALOG_SOURCE=snapshot  (default) → baca `.data/erp/catalog.snapshot.json`
 *   OSR_CATALOG_SOURCE=live                → tarik langsung dari ERP saat boot
 *
 * Mode live tetap punya fallback ke snapshot selama `OSR_ERP_STRICT` bukan "1",
 * supaya demo tidak mati hanya karena ERP sedang down.
 */

let memo: { source: CatalogMeta["source"]; snapshot: ErpSnapshot } | null = null;

export function catalogSource(): "snapshot" | "live" {
  return (process.env.OSR_CATALOG_SOURCE || "snapshot").toLowerCase() === "live"
    ? "live"
    : "snapshot";
}

export async function loadSnapshot(): Promise<{
  source: CatalogMeta["source"];
  snapshot: ErpSnapshot;
}> {
  if (memo) return memo;

  if (catalogSource() === "live") {
    try {
      const snapshot = await pullSnapshot(process.env);
      memo = { source: "live", snapshot };
      return memo;
    } catch (err) {
      const fallback = readSnapshotIfPresent();
      const strict = process.env.OSR_ERP_STRICT === "1";
      if (!fallback || strict) {
        throw new Error(
          `Gagal menarik katalog dari ERP (${resolveErpConfig().baseUrl}): ` +
            `${(err as Error).message}` +
            (fallback ? "" : ` Snapshot lokal juga tidak ada di ${snapshotPath()}.`),
        );
      }
      console.warn(
        `[erp] live pull gagal (${(err as Error).message}); memakai snapshot ${fallback.fetched_at}`,
      );
      memo = { source: "snapshot", snapshot: fallback };
      return memo;
    }
  }

  memo = { source: "snapshot", snapshot: readSnapshot() };
  return memo;
}

/** Versi sinkron — hanya valid untuk mode snapshot (dipakai Server Components). */
export function loadSnapshotSync(): {
  source: CatalogMeta["source"];
  snapshot: ErpSnapshot;
} {
  if (memo) return memo;
  if (catalogSource() === "live") {
    const fallback = readSnapshotIfPresent();
    if (fallback) {
      console.warn(
        "[erp] OSR_CATALOG_SOURCE=live tetapi render sinkron; memakai snapshot terakhir. " +
          "Panaskan snapshot lewat `npm run erp:sync` untuk menghindari request ERP di request path.",
      );
      memo = { source: "snapshot", snapshot: fallback };
      return memo;
    }
    throw new Error(
      "OSR_CATALOG_SOURCE=live membutuhkan minimal satu snapshot. Jalankan `npm run erp:sync`.",
    );
  }
  memo = { source: "snapshot", snapshot: readSnapshot() };
  return memo;
}

export function resetErpCache() {
  memo = null;
}