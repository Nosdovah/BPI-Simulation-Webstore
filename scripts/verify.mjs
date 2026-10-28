/**
 * Smoke test master data ERP tanpa menjalankan Next.
 * Jalankan: node scripts/verify.mjs
 *
 * Memeriksa integritas snapshot yang dipakai webstore: checksum, duplikat SKU,
 * relasi BOM, stok negatif, dan kapasitas paket yang bisa dijual.
 */
import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const SNAPSHOT = `${ROOT}.data/erp/catalog.snapshot.json`;
const MANIFEST = `${ROOT}.data/erp/manifest.json`;

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
}

if (!existsSync(SNAPSHOT)) {
  console.error(
    `Snapshot tidak ditemukan di ${SNAPSHOT}\nJalankan dulu: npm run erp:sync`,
  );
  process.exit(1);
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : null;
const data = snapshot.data ?? {};

const products = data.products ?? [];
const balances = data.balances ?? [];
const boms = data.boms ?? [];

check("snapshot version 1", snapshot.version === 1, `version=${snapshot.version}`);

check(
  "checksum snapshot = manifest",
  !manifest || manifest.checksum === snapshot.checksum,
  snapshot.checksum.slice(0, 12),
);

check("ada produk", products.length > 0, `${products.length} produk`);

const skus = products.map((p) => p.sku ?? p.id);
const dupes = skus.filter((s, i) => skus.indexOf(s) !== i);
check("SKU unik", dupes.length === 0, dupes.slice(0, 3).join(", "));

const skuSet = new Set(skus);
const orphanComponents = boms.flatMap((b) =>
  (b.components ?? [])
    .map((c) => c.component_sku)
    .filter((s) => !skuSet.has(s)),
);
check(
  "semua komponen BOM ada di master",
  orphanComponents.length === 0,
  orphanComponents.slice(0, 3).join(", "),
);

const orphanTargets = boms
  .map((b) => b.target_sku)
  .filter((s) => !skuSet.has(s));
check(
  "semua target BOM ada di master",
  orphanTargets.length === 0,
  orphanTargets.slice(0, 3).join(", "),
);

const negative = balances.filter((b) => Number(b.available) < 0);
check(
  "tidak ada stok negatif",
  negative.length === 0,
  negative.slice(0, 3).map((b) => b.sku).join(", "),
);

const balBySku = new Map(balances.map((b) => [b.sku, b]));

const capacityReport = [];
let capacityOk = true;
for (const bom of boms) {
  const legs = (bom.components ?? []).map((c) => {
    const bal = balBySku.get(c.component_sku);
    if (!bal) capacityOk = false;
    const available = Number(bal?.available ?? 0);
    const qty = Number(c.qty) || 1;
    return Math.floor(available / qty);
  });
  const capacity = legs.length ? Math.min(...legs) : 0;
  capacityReport.push(`${bom.target_sku}=${capacity}`);
}
check("kapasitas paket bisa dihitung", capacityOk && boms.length > 0, capacityReport.join(" "));

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}

if (failed.length) {
  console.error(`\n${failed.length} pemeriksaan gagal.`);
  process.exit(1);
}
console.log("\nSemua pemeriksaan integritas master data lolos.");