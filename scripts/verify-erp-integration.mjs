#!/usr/bin/env node
/**
 * verify:integration — uji end-to-end storefront ↔ ERP (replika Perpack).
 *
 *   npm run verify:integration
 *
 * Jalur yang diuji (semua lewat kontrak resmi, tanpa /api/v2/*):
 *
 *   A. Katalog    GET  /api/webhooks/catalog        → 3.727 produk, field sesuai
 *   B. Checkout   POST /api/webhooks/purchase-order → order dibuat (status paid)
 *   C. Idempoten  POST ulang reference_no sama      → applied:false, order_id sama
 *   D. Baca balik POST /v1/orders/page (search)     → reference_no ketemu, status paid
 *   E. Status     POST /api/webhooks/wms (status_changed) → process
 *   F. Stok       POST /api/webhooks/wms (stock.updated)  → effect.sisa_stok_total
 *   G. BOM        GET  /api/to-be/bundle-stock      → stock_to_be = MIN(⌊stok/mult⌋)
 *   H. Audit      GET  /api/webhooks/wms?limit=     → event_id kita tercatat
 *
 * CATATAN: skrip ini MENULIS ke ERP (membuat order uji + 1 event stok).
 * Order uji memakai prefix `ORD-WEBSTORE-VERIFY-` supaya mudah dikenali.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveErpConfig, getJson, postJson, normalizeBundleStock, ERP_ENDPOINTS } from "../lib/erp/pull.mjs";
import {
  ERP_ORDER_PATHS,
  mapErpStatus,
  fetchErpOrder,
  updateErpOrderStatus,
  pushStockUpdated,
  listWebhookEvents,
} from "../lib/erp/order.mjs";

const cfg = resolveErpConfig(process.env);
const SNAPSHOT = process.env.OSR_ERP_SNAPSHOT_PATH || join(process.cwd(), ".data", "erp", "catalog.snapshot.json");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function pickSkus() {
  if (!existsSync(SNAPSHOT)) {
    throw new Error(`Snapshot tidak ada di ${SNAPSHOT}. Jalankan \`npm run erp:sync\` dulu.`);
  }
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const products = snap.data?.products ?? [];
  const single = products.find(
    (p) => !p.is_bundle && Number(p.stock_available) > 10 && Number(p.sell_price) > 0,
  );

  /* Bundle uji dipilih yang benar-benar menguji rumus: ada multiplier > 1
   * ATAU phantom ≠ 0. Bundle multiplier=1 & phantom=0 lolos walau MIN() salah. */
  const candidates = products.filter(
    (p) => p.is_bundle && Array.isArray(p.components) && p.components.length > 0,
  );
  const bundle =
    candidates.find(
      (p) =>
        p.components.some((c) => Number(c.multiplier_qty) > 1) ||
        Number(p.stock_available) !== Number(p.stock_to_be),
    ) ?? candidates[0];

  return { single, bundle, snapshot: snap };
}

async function main() {
  console.log(`→ integrasi ERP: ${cfg.baseUrl}\n`);
  const { single, bundle, snapshot } = pickSkus();

  /* ---------------------------------------------------------- A. katalog --- */
  const cat = await getJson(cfg, `${ERP_ENDPOINTS.catalog}?page=1&length=1`);
  const expected = Number(cat.metadata?.count ?? 0);
  check(
    "A. katalog metadata.count terbaca",
    expected > 3000,
    `${expected} produk (snapshot ${snapshot.counts?.products ?? "-"})`,
  );
  check(
    "A. snapshot sinkron dengan ERP",
    expected === Number(snapshot.counts?.products ?? -1),
    `ERP ${expected} vs snapshot ${snapshot.counts?.products}`,
  );

  /* --------------------------------------------------------- B. checkout --- */
  const ref = `ORD-WEBSTORE-VERIFY-${Date.now()}`;
  const items = [{ sku: single.sku, qty: 1, price: Number(single.sell_price) }];
  const po = await postJson(cfg, ERP_ORDER_PATHS.purchaseOrder, {
    reference_no: ref,
    channel: "WEBSTORE",
    customer_name: "Verifikasi Integrasi",
    customer_phone: "628000000000",
    customer_email: "verify@contoh.id",
    items,
  });
  const poData = po.data ?? {};
  check("B. order dibuat di ERP", poData.applied !== false && Boolean(poData.order_id), `order_id=${poData.order_id}`);
  check("B. status awal = paid", String(poData.status).toLowerCase() === "paid", poData.status);
  check(
    "B. amount = qty × sell_price",
    Number(poData.amount) === Number(single.sell_price) * 1,
    `${poData.amount} vs ${single.sell_price}`,
  );
  check("B. product_summary terisi", Boolean(poData.product_summary), poData.product_summary ?? "-");

  /* -------------------------------------------------------- C. idempoten --- */
  const po2 = await postJson(cfg, ERP_ORDER_PATHS.purchaseOrder, {
    reference_no: ref,
    channel: "WEBSTORE",
    customer_name: "Verifikasi Integrasi",
    items,
  });
  const po2Data = po2.data ?? {};
  check("C. ref sama tidak membuat order ganda", po2Data.applied === false, `applied=${po2Data.applied}`);
  check("C. order_id tetap sama", Number(po2Data.order_id) === Number(poData.order_id), `${po2Data.order_id}`);

  /* -------------------------------------------------------- D. baca balik --- */
  const lookup = await fetchErpOrder(cfg, ref);
  check("D. order terbaca via /v1/orders/page", lookup.ok && lookup.found, lookup.error ?? ref);
  check("D. status terbaca = paid", lookup.status === "PAID", `${lookup.rawStatus} → ${lookup.status}`);
  check("D. reference_no cocok", lookup.raw?.reference_no === ref, lookup.raw?.reference_no ?? "-");

  /* ------------------------------------------------------------ E. status --- */
  const advanced = await updateErpOrderStatus(cfg, ref, "process");
  check("E. status_changed diterima", advanced.ok && advanced.applied !== false, advanced.error ?? "process");
  const afterAdvance = await fetchErpOrder(cfg, ref);
  check("E. status di ERP jadi process", afterAdvance.rawStatus === "process", afterAdvance.rawStatus ?? "-");
  check(
    "E. pemetaan enum ERP → storefront",
    mapErpStatus("process") === "PROCESS" &&
      mapErpStatus("ready_to_pickup") === "READY_TO_PICKUP" &&
      mapErpStatus("sent") === "SENT",
    "process/ready_to_pickup/sent",
  );

  /* -------------------------------------------------------------- F. stok --- */
  const stockEvent = await pushStockUpdated(cfg, single.sku, 1);
  check("F. stock.updated diterima", stockEvent.ok, stockEvent.error ?? single.sku);
  check(
    "F. efek stok dilaporkan",
    Boolean(stockEvent.effect && typeof stockEvent.effect.sisa_stok_total === "number"),
    stockEvent.effect ? `sisa=${stockEvent.effect.sisa_stok_total}` : "-",
  );

  /* --------------------------------------------------------------- G. BOM --- */
  const bs = await getJson(cfg, `${ERP_ENDPOINTS.bundleStock}?sku=${encodeURIComponent(bundle.sku)}`);
  const b = normalizeBundleStock(bs.data).bundles.find((x) => x.sku === bundle.sku);
  check("G. bundle-stock mengembalikan SKU uji", Boolean(b), bundle.sku);
  if (b) {
    const expectedToBe = Math.min(
      ...b.components.map((c) => Math.floor(Number(c.stock) / Math.max(1, Number(c.multiplier)))),
    );
    check("G. stock_to_be = MIN(⌊stok/multiplier⌋)", Number(b.stock_to_be) === expectedToBe, `${b.stock_to_be} vs ${expectedToBe}`);
    check(
      "G. phantom = stock_as_is − stock_to_be",
      Number(b.phantom) === Number(b.stock_as_is) - Number(b.stock_to_be),
      `${b.phantom}`,
    );
  }

  /* ------------------------------------------------------------- H. audit --- */
  const events = await listWebhookEvents(cfg, { limit: 50 });
  check("H. riwayat webhook terbaca", events.length > 0, `${events.length} event`);
  check(
    "H. event stock.updated kita tercatat",
    events.some((e) => e.event === "stock.updated" && String(e.effect ?? "").includes(single.sku)),
    single.sku,
  );

  /* ------------------------------------------------------------ ringkasan --- */
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? "✓ INTEGRASI SEHAT" : "✗ ADA YANG GAGAL"} — ` +
      `${results.length - failed.length}/${results.length} pemeriksaan lulus`,
  );
  console.log(`  order uji : ${ref} (order_id ${poData.order_id}, status process)`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✗ verify:integration gagal — ${err.message}`);
  process.exit(1);
});
