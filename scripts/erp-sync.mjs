#!/usr/bin/env node
/**
 * erp:sync — tarik master data ERP (replika Perpack) lalu tulis snapshot.
 *
 *   npm run erp:sync
 *
 * Kontrak: /api/webhooks/catalog (flat), /v1/products/group/page (stok per
 * gudang), /v1/warehouses, /v1/channels, /api/to-be/bundle-stock,
 * /api/to-be/sales-summary. `/api/v2/*` sudah ditinggalkan.
 *
 * Env yang dipakai:
 *   OSR_ERP_BASE_URL          default https://web-production-e60b55.up.railway.app
 *   OSR_ERP_TOKEN             opsional (replika terbuka)
 *   OSR_ERP_TIMEOUT_MS        default 30000
 *   OSR_ERP_RETRIES           default 2
 *   OSR_ERP_WAREHOUSE_STOCK   1 (default) = ikut tarik stok per gudang
 *
 * Output:
 *   .data/erp/catalog.snapshot.json   data lengkap + integrity + checksum
 *   .data/erp/manifest.json           ringkasan tanpa payload (aman untuk di-commit/diff)
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pullSnapshot } from "../lib/erp/pull.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.OSR_ERP_OUT_DIR || join(here, "..", ".data", "erp");
const snapshotFile = join(outDir, "catalog.snapshot.json");
const manifestFile = join(outDir, "manifest.json");

const fmt = (n) => new Intl.NumberFormat("id-ID").format(n ?? 0);

function readPreviousManifest() {
  if (!existsSync(manifestFile)) return null;
  try {
    return JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  console.log("→ menarik master data dari ERP (replika Perpack) ...");
  const started = Date.now();
  const snapshot = await pullSnapshot(process.env);
  const elapsed = Date.now() - started;

  mkdirSync(outDir, { recursive: true });

  const prev = readPreviousManifest();
  const manifest = {
    contract: snapshot.contract,
    fetched_at: snapshot.fetched_at,
    base_url: snapshot.source.base_url,
    checksum: snapshot.checksum,
    counts: snapshot.counts,
    integrity: snapshot.integrity,
    previous: prev
      ? {
          fetched_at: prev.fetched_at,
          checksum: prev.checksum,
          counts: prev.counts,
        }
      : null,
  };

  writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), "utf8");
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`✓ selesai dalam ${elapsed} ms`);
  console.log(`  snapshot : ${snapshotFile}`);
  console.log(`  manifest : ${manifestFile}`);
  console.log(`  checksum : ${snapshot.checksum.slice(0, 16)}…`);
  console.log(
    `  counts   : ${fmt(snapshot.counts.products)} produk · ` +
      `${fmt(snapshot.counts.variants)} varian · ` +
      `${fmt(snapshot.counts.groups)} grup · ` +
      `${fmt(snapshot.counts.warehouses)} gudang · ` +
      `${fmt(snapshot.counts.channels)} channel · ` +
      `${fmt(snapshot.counts.bundles)} bundle`,
  );

  const { integrity } = snapshot;
  console.log(
    `  katalog  : metadata.count=${fmt(integrity.catalog_count_expected)} · ` +
      `diterima=${fmt(integrity.catalog_count_actual)} · ` +
      `paginasi ${integrity.catalog_pagination_complete ? "lengkap" : "TERPOTONG"}`,
  );

  if (integrity.catalog_count_actual !== integrity.catalog_count_expected) {
    console.log(
      `  ✗ GATE GAGAL: jumlah produk tidak sama dengan metadata.count ` +
        `(${integrity.catalog_count_actual} vs ${integrity.catalog_count_expected}). ` +
        `Periksa batas paginasi (server memotong length > 500).`,
    );
    process.exitCode = 1;
  }

  const toBe = integrity.bundle_stock_summary;
  if (toBe) {
    console.log(
      `  TO-BE    : ${fmt(toBe.total_bundles)} bundle — ` +
        `oversell ${fmt(toBe.oversell)} · understate ${fmt(toBe.understate)} · ` +
        `matched ${fmt(toBe.matched)}`,
    );
  }

  if (prev && prev.checksum !== snapshot.checksum) {
    console.log("  Δ data berubah sejak sync sebelumnya:");
    for (const key of Object.keys(snapshot.counts)) {
      const before = prev.counts?.[key] ?? 0;
      const after = snapshot.counts[key] ?? 0;
      if (before !== after) console.log(`    ${key}: ${before} → ${after}`);
    }
  } else if (prev) {
    console.log("  Δ tidak ada perubahan data (checksum sama)");
  }

  const problems =
    integrity.duplicate_skus.length +
    integrity.bundles_without_components.length +
    integrity.missing_components.length +
    integrity.missing_price.length +
    integrity.negative_stock.length;

  if (problems > 0) {
    console.log("  ⚠ temuan integritas master data:");
    if (integrity.duplicate_skus.length) {
      console.log(`    SKU duplikat: ${integrity.duplicate_skus.slice(0, 5).join(", ")}`);
    }
    if (integrity.bundles_without_components.length) {
      console.log(
        `    ${integrity.bundles_without_components.length} bundle tanpa komponen ` +
          `(contoh: ${integrity.bundles_without_components.slice(0, 3).join(", ")})`,
      );
    }
    if (integrity.missing_components.length) {
      for (const m of integrity.missing_components.slice(0, 5)) {
        console.log(`    bundle ${m.sku} → komponen tidak ada di master: ${m.missing.join(", ")}`);
      }
    }
    if (integrity.missing_price.length) {
      console.log(
        `    ${integrity.missing_price.length} SKU tanpa harga jual ` +
          `(contoh: ${integrity.missing_price.slice(0, 3).join(", ")})`,
      );
    }
    if (integrity.negative_stock.length) {
      console.log(`    stok negatif: ${integrity.negative_stock.slice(0, 5).join(", ")}`);
    }
  } else {
    console.log("  ✓ integritas referensial bersih");
  }
}

main().catch((err) => {
  console.error(`✗ erp:sync gagal — ${err.message}`);
  if (err.fatal) {
    console.error("  Periksa OSR_ERP_BASE_URL / OSR_ERP_TOKEN lalu ulangi.");
  }
  process.exit(1);
});
