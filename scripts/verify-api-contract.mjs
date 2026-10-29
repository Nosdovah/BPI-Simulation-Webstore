#!/usr/bin/env node
/**
 * verify:contract — pastikan storefront memakai kontrak yang BENAR-BENAR hidup
 * di ERP (replika Perpack), bukan asumsi dari dokumen lama.
 *
 *   npm run verify:contract
 *
 * Yang diperiksa:
 *   1. `/openapi.json` bisa dibaca (sumber kanonik).
 *   2. Semua endpoint yang dipakai storefront ADA di sana.
 *   3. Endpoint blueprint-v2 (`/api/v2/*`) TIDAK dipakai lagi.
 *   4. Envelope respons sesuai (`{code,msg,data,metadata}`).
 *   5. Field wajib ada di sampel data (`sku`, `sell_price`, `stock_available`, …).
 *   6. Enum status ERP = 10 nilai yang diharapkan.
 */

import {
  resolveErpConfig,
  getJson,
  postJson,
  ERP_ENDPOINTS,
} from "../lib/erp/pull.mjs";
import { ERP_STATUSES } from "../lib/erp/order.mjs";

const cfg = resolveErpConfig(process.env);
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const REQUIRED_PATHS = [
  ERP_ENDPOINTS.catalog,
  ERP_ENDPOINTS.purchaseOrder,
  ERP_ENDPOINTS.wmsEvents,
  ERP_ENDPOINTS.ordersPage,
  ERP_ENDPOINTS.warehouses,
  ERP_ENDPOINTS.channels,
  ERP_ENDPOINTS.groups,
  ERP_ENDPOINTS.productsList,
  ERP_ENDPOINTS.bundleStock,
  ERP_ENDPOINTS.salesSummary,
];

const FORBIDDEN_PATHS = [
  "/api/v2/master/products",
  "/api/v2/inventory/balances",
  "/api/v2/assembly/boms",
  "/v1/open/sales-order",
];

async function main() {
  console.log(`→ kontrak ERP: ${cfg.baseUrl}\n`);

  /* 1. openapi.json */
  let paths = [];
  try {
    const spec = await getJson(cfg, "/openapi.json");
    paths = Object.keys(spec.paths ?? {});
    check("GET /openapi.json terbaca", paths.length > 0, `${paths.length} path`);
  } catch (err) {
    check("GET /openapi.json terbaca", false, err.message);
  }

  /* 2. endpoint wajib */
  for (const p of REQUIRED_PATHS) {
    check(`path tersedia: ${p}`, paths.includes(p));
  }

  /* 3. endpoint v2 harus hilang */
  for (const p of FORBIDDEN_PATHS) {
    check(`path v2 sudah ditinggalkan: ${p}`, !paths.includes(p));
  }

  /* 4. envelope + field katalog */
  try {
    const cat = await getJson(cfg, `${ERP_ENDPOINTS.catalog}?page=1&length=1`);
    const row = cat.data?.[0] ?? {};
    check(
      "envelope katalog {code,msg,data,metadata}",
      cat.code === 200 && Boolean(cat.msg?.id) && Array.isArray(cat.data) && Boolean(cat.metadata),
      `count=${cat.metadata?.count}`,
    );
    const required = ["sku", "name", "sell_price", "is_bundle", "components", "stock_available"];
    const missing = required.filter((f) => !(f in row));
    check("field katalog sesuai kontrak", missing.length === 0, missing.length ? `hilang: ${missing}` : "6/6 field");
  } catch (err) {
    check("field katalog sesuai kontrak", false, err.message);
  }

  /* 5. order 40 field + enum status */
  try {
    const page = await postJson(cfg, ERP_ENDPOINTS.ordersPage, { page: 1, length: 1 });
    const row = page.data?.[0] ?? {};
    const keys = Object.keys(row);
    check("order punya 40 field", keys.length === 40, `${keys.length} field`);
    const keyFields = ["reference_no", "order_at", "amount", "status", "product_summary"];
    const missing = keyFields.filter((f) => !(f in row));
    check("field kunci order sesuai kontrak", missing.length === 0, missing.length ? `hilang: ${missing}` : "ok");
    check(
      "kunci order = reference_no (bukan id)",
      typeof row.reference_no === "string" && row.reference_no.length > 0,
      row.reference_no ?? "-",
    );
    check(
      "status order ada di enum resmi",
      ERP_STATUSES.includes(String(row.status).toLowerCase()),
      row.status ?? "-",
    );
  } catch (err) {
    check("field kunci order sesuai kontrak", false, err.message);
  }

  /* 6. TO-BE bundle-stock */
  try {
    const bs = await getJson(cfg, `${ERP_ENDPOINTS.bundleStock}?limit=1`);
    const b = bs.data?.bundles?.[0];
    const ok =
      Boolean(b) &&
      typeof b.stock_to_be === "number" &&
      typeof b.stock_as_is === "number" &&
      Array.isArray(b.components);
    check("bundle-stock punya stock_to_be/stock_as_is/components", ok, b?.sku ?? "-");
  } catch (err) {
    check("bundle-stock punya stock_to_be/stock_as_is/components", false, err.message);
  }

  /* 7. warehouse & channel */
  try {
    const wh = await getJson(cfg, ERP_ENDPOINTS.warehouses);
    check("GET /v1/warehouses", Array.isArray(wh.data) && wh.data.length > 0, `${wh.data.length} gudang`);
    const ch = await getJson(cfg, ERP_ENDPOINTS.channels);
    const webstore = (ch.data ?? []).find((c) => Number(c.id) === 13);
    check("channel 13 = WEBSTORE", Boolean(webstore), webstore?.name ?? "tidak ada");
  } catch (err) {
    check("GET /v1/warehouses", false, err.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? "✓ KONTRAK COCOK" : "✗ KONTRAK TIDAK COCOK"} — ` +
      `${results.length - failed.length}/${results.length} pemeriksaan lulus`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✗ verify:contract gagal — ${err.message}`);
  process.exit(1);
});
