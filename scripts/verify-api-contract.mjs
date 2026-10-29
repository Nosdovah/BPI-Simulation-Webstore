#!/usr/bin/env node
/**
 * verify-api-contract.mjs — gate kontrak API ERP (acuan resmi v1.0).
 *
 * Menjalankan 18 gate dari docs/KONTRAK_API_ERP_ACUAN_RESMI.md §9 terhadap
 * instance ERP yang hidup. Exit 0 = kontrak utuh; exit 1 = ada gate gagal
 * (kontrak tidak boleh dijadikan acuan sampai diperbaiki).
 *
 * Pakai:
 *   OSR_ERP_BASE_URL=http://127.0.0.1:8100 node scripts/verify-api-contract.mjs
 *
 * Prasyarat: ERP dijalankan dari branch pin `feat/api-v1-v2-contract`
 * (main@3599e82 tidak punya /api/v1/*, sehingga gate 11-16 akan gagal).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.OSR_ERP_BASE_URL || "http://127.0.0.1:8100").replace(/\/+$/, "");
const CONTRACT = JSON.parse(
  readFileSync(path.join(process.cwd(), "docs", "api-contract.erp.v2.json"), "utf8"),
);

const BUNDLE_SKU = "Sanctum+Noctis-20ml-A1";
const ORDER_REF = `VERIFY-${Date.now().toString().slice(-6)}`;
const results = [];

function gate(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? "LULUS" : "GAGAL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function call(method, path_, body) {
  const url = `${BASE}${path_}`;
  const init = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { _raw: text };
    }
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: { _error: String(err) } };
  }
}

const counts = CONTRACT.endpoints.filter((e) => e.family === "v2" && e.expect_count_tobe !== undefined);

console.log(`\nKontrak: ${CONTRACT.name} v${CONTRACT.version} (${CONTRACT.status})`);
console.log(`Pin    : ${CONTRACT.pin.branch}@${CONTRACT.pin.commit.slice(0, 7)}`);
console.log(`Target : ${BASE}\n`);

/* 1 — healthz */
{
  const { status, json } = await call("GET", "/healthz");
  gate("GET /healthz -> ok:true", status === 200 && json.ok === true, `mode=${json.mode}`);
}

/* 2-8 — read-model v2 counts */
for (const ep of counts) {
  const { status, json } = await call("GET", `${ep.path}?limit=5000`);
  const want = ep.expect_count_tobe;
  gate(`${ep.path} count=${want}`, status === 200 && json.count === want, `aktual=${json.count}`);
}

/* 8b — BOM (count bergantung mode: tobe=1, baseline=0) */
{
  const ep = CONTRACT.endpoints.find((e) => e.id === "v2_boms");
  const { status, json } = await call("GET", ep.path);
  const health = await call("GET", "/healthz");
  const mode = health.json.mode || "tobe";
  const want = ep.expect_count[mode] ?? ep.expect_count.tobe;
  gate(`${ep.path} count=${want} (mode=${mode})`, status === 200 && json.count === want, `aktual=${json.count}`);
}

/* 9 — inventory bundle */
{
  const { status, json } = await call("GET", `/api/v1/inventory/${BUNDLE_SKU}`);
  const d = json.data || {};
  const want = CONTRACT.endpoints.find((e) => e.id === "v1_inventory").expect_bundle_tobe;
  gate(
    `GET /api/v1/inventory/{bundle} = ${want.available_stock}, ${want.components} komponen`,
    status === 200 && d.available_stock === want.available_stock && (d.components || []).length === want.components,
    `stock=${d.available_stock} komponen=${(d.components || []).length} envelope=${"code" in json}`,
  );
}

/* 10 — 404 SKU tidak ada */
{
  const { status, json } = await call("GET", "/api/v1/inventory/SKU-TIDAK-ADA");
  gate("GET /api/v1/inventory/{unknown} -> 404", status === 404, `detail=${json.detail}`);
}

/* 11 — checkout (tanpa envelope) */
{
  const { status, json } = await call("POST", "/api/v1/storefront/checkout", {
    order_ref: ORDER_REF,
    channel: "WEBSTORE",
    items: [{ sku: "M2291", qty: 2 }],
  });
  const flat = !("code" in json) && !("data" in json);
  gate(
    "POST /api/v1/storefront/checkout -> 200, status=process, updated_by=SYSTEM, tanpa envelope",
    status === 200 && json.status === "process" && json.updated_by === "SYSTEM" && flat,
    `keys=${Object.keys(json).join(",")}`,
  );
}

/* 12 — stok komponen terpotong */
{
  const { json } = await call("GET", "/api/v1/inventory/M2291");
  const stock = (json.data || {}).available_stock;
  gate("stok M2291 terpotong setelah checkout qty 2", typeof stock === "number" && stock < 11927, `aktual=${stock}`);
}

/* 13 — transition packed */
{
  const { status, json } = await call("POST", `/api/v1/wms/orders/${ORDER_REF}/transition?target_status=packed`);
  const d = json.data || {};
  gate(
    "POST transition packed -> from=process to=packed",
    status === 200 && d.from === "process" && d.to === "packed",
    `webhook_sent=${d.webhook_sent} webhook_status=${d.webhook_status}`,
  );
}

/* 14 — no-regression */
{
  const { status, json } = await call("POST", `/api/v1/wms/orders/${ORDER_REF}/transition?target_status=paid`);
  gate("transition mundur -> 409 no-regression", status === 409, `detail=${json.detail}`);
}

/* 15 — enum tidak dikenal */
{
  const { status, json } = await call("POST", `/api/v1/wms/orders/${ORDER_REF}/transition?target_status=on_process`);
  gate("transition enum non-baku -> 422", status === 422, `detail=${json.detail}`);
}

/* 16 — order tidak ada */
{
  const { status, json } = await call("POST", "/api/v1/wms/orders/TIDAK-ADA/transition?target_status=packed");
  gate("transition order tak dikenal -> 404", status === 404, `detail=${json.detail}`);
}

/* 17 — audit webhook-logs (pengiriman webhook = background task; tunggu singkat) */
{
  let rows = [];
  let status = 0;
  for (let i = 0; i < 10; i++) {
    const r = await call("GET", "/api/v1/audit/webhook-logs?limit=10");
    status = r.status;
    rows = r.json.data || [];
    if (rows.length > 0) break;
    await new Promise((res) => setTimeout(res, 300));
  }
  const signed = rows.filter((r) => String(r.signature || "").startsWith("sha256="));
  gate(
    "GET /api/v1/audit/webhook-logs -> baris + signature sha256",
    status === 200 && signed.length > 0,
    `n=${rows.length} http=${[...new Set(rows.map((r) => r.http_status))].join("/") || "-"}`,
  );
}

/* 18 — openapi memuat endpoint kunci */
{
  const { json } = await call("GET", "/openapi.json");
  const paths = Object.keys(json.paths || {});
  const need = [
    "/api/v1/storefront/checkout",
    "/api/v1/wms/orders/{order_ref}/transition",
    "/api/v1/inventory/{sku}",
    "/api/v1/audit/webhook-logs",
    "/api/v2/master/products",
    "/api/v2/assembly/boms",
  ];
  const missing = need.filter((p) => !paths.includes(p));
  gate("openapi.json memuat 6 endpoint kunci", missing.length === 0, `paths=${paths.length} missing=${missing.join(",") || "-"}`);
}

/* Ringkasan */
const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`\n=== RINGKASAN: ${passed}/${total} ${passed === total ? "LULUS" : "GAGAL"} ===`);
if (passed !== total) {
  for (const r of results.filter((x) => !x.ok)) console.log(`  GAGAL: ${r.name} — ${r.detail}`);
  console.log(
    "\nCatatan: bila gate 11-16 gagal sementara 2-8 lulus, ERP kemungkinan berjalan dari " +
      "main@3599e82 (tanpa /api/v1/*). Jalankan dari branch pin " +
      `${CONTRACT.pin.branch}@${CONTRACT.pin.commit.slice(0, 7)}.`,
  );
}
process.exit(passed === total ? 0 : 1);
