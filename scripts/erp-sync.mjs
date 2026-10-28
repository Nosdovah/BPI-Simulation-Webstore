#!/usr/bin/env node
/**
 * erp:sync — tarik master data ERP lalu tulis snapshot untuk webstore.
 *
 *   npm run erp:sync
 *
 * Env yang dipakai:
 *   OSR_ERP_BASE_URL   default https://scm-erp-pied.vercel.app
 *   OSR_ERP_TOKEN      token service ERP (wajib untuk project yang menutup demo token)
 *   OSR_ERP_TIMEOUT_MS default 20000
 *   OSR_ERP_RETRIES    default 2
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

const fmt = (n) => new Intl.NumberFormat("id-ID").format(n);

function readPreviousManifest() {
  if (!existsSync(manifestFile)) return null;
  try {
    return JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  console.log("→ menarik master data dari ERP ...");
  const started = Date.now();
  const snapshot = await pullSnapshot(process.env);
  const elapsed = Date.now() - started;

  mkdirSync(outDir, { recursive: true });

  const prev = readPreviousManifest();
  const manifest = {
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
      `${fmt(snapshot.counts.balances)} saldo · ` +
      `${fmt(snapshot.counts.boms)} BOM · ` +
      `${fmt(snapshot.counts.warehouses)} gudang`,
  );

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

  const { integrity } = snapshot;
  const problems =
    integrity.orphan_boms.length +
    integrity.missing_price.length +
    integrity.duplicate_skus.length +
    integrity.negative_stock.length;

  if (problems > 0) {
    console.log("  ⚠ temuan integritas master data:");
    for (const bom of integrity.orphan_boms) {
      const missing = [
        bom.missing_target ? `target ${bom.target_sku}` : null,
        ...bom.missing_components,
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`    orphan BOM ${bom.target_sku} → tidak ada di master: ${missing}`);
    }
    if (integrity.missing_price.length) {
      console.log(
        `    ${integrity.missing_price.length} SKU tanpa harga jual (contoh: ${integrity.missing_price
          .slice(0, 3)
          .join(", ")})`,
      );
    }
    if (integrity.duplicate_skus.length) {
      console.log(`    SKU duplikat: ${integrity.duplicate_skus.join(", ")}`);
    }
    if (integrity.negative_stock.length) {
      console.log(`    stok negatif: ${integrity.negative_stock.join(", ")}`);
    }
  } else {
    console.log("  ✓ integritas referensial bersih");
  }
}

main().catch((err) => {
  console.error(`✗ erp:sync gagal — ${err.message}`);
  if (err.fatal) {
    console.error("  Periksa OSR_ERP_TOKEN / OSR_ERP_BASE_URL lalu ulangi.");
  }
  process.exit(1);
});