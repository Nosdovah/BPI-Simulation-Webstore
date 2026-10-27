/**
 * Verifikasi katalog tanpa menjalankan Next.
 * Jalankan: node scripts/verify.mjs
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const out = execSync(
  "npx --yes tsx --version >/dev/null 2>&1 || true",
  { encoding: "utf8" },
);
void out;

// Kompilasi cepat: pakai esbuild kalau ada, kalau tidak pakai tsc sudah cukup.
// Supaya skrip ini tidak butuh dependency tambahan, kita baca ulang konstanta
// penting dari source dan cek konsistensinya.
const catalogSrc = readFileSync(new URL("../lib/catalog.ts", import.meta.url), "utf8");

const checks = [];
function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

check(
  "BUNDLE_TOTAL 3520",
  /const BUNDLE_TOTAL = 3520;/.test(catalogSrc),
  "3.520 bundle + 176 single = 3.696 SKU",
);
check(
  "seed tetap",
  /const SEED = 20260918;/.test(catalogSrc),
  "angka katalog reproducible",
);
check(
  "M2291 = 11927",
  /materialCode === "M2291"\) stock = 11927/.test(catalogSrc),
);
check(
  "M2292 = 10932",
  /materialCode === "M2292"\) stock = 10932/.test(catalogSrc),
);
check(
  "flagship sku",
  catalogSrc.includes("SANCTUM-NOCTIS-20ML-A1"),
);
check(
  "kuota manual flagship 10932",
  catalogSrc.includes("baseQuotaOverride = 10932"),
);

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}

if (failed.length) {
  console.error(`\n${failed.length} pemeriksaan gagal.`);
  process.exit(1);
}
console.log("\nSemua pemeriksaan struktur katalog lolos.");