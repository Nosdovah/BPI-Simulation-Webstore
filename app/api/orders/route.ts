import { NextResponse } from "next/server";
import { addSold, pushTelemetry } from "@/lib/state";
import { findProductsBySkus, findProduct } from "@/lib/catalog";
import { checkStock } from "@/lib/core";
import {
  applyErpPush,
  buildOrder,
  nextOrderRef,
  rememberOrder,
  signOrder,
} from "@/lib/orders";
import { pushOrder, pushStockUpdated, resolveErpOrderConfig } from "@/lib/erp/order.mjs";
import type { OrderItem } from "@/lib/types";

type Payload = {
  customer?: { name?: string; phone?: string; email?: string };
  shipping?: {
    address?: string;
    city?: string;
    postalCode?: string;
    courier?: string;
    service?: string;
    costIdr?: number;
  };
  items?: Array<{ sku?: string; qty?: number }>;
  client_ref?: string;
  idempotency_key?: string;
};

const COURIER_COST: Record<string, number> = {
  sicepat: 18000,
  jnt: 16000,
  anteraja: 15000,
  instant: 32000,
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Payload;

  const rawItems = (body.items ?? []).filter(
    (i): i is { sku: string; qty: number } =>
      typeof i?.sku === "string" && Number(i?.qty) > 0,
  );

  if (rawItems.length === 0) {
    return NextResponse.json(
      { error: "EMPTY_CART", message: "Keranjang kosong." },
      { status: 400 },
    );
  }

  // Validasi ulang stok di core — bukan di UI
  const check = checkStock(rawItems);
  if (!check.ok) {
    const failed = check.lines.filter((l) => !l.ok);
    pushTelemetry({
      event: "stock_reject",
      code: failed.some((f) => f.error === "Data komposisi tidak tersedia")
        ? "COMPOSITION_MISSING"
        : "STOCK_CHANGED",
      skus: failed.map((f) => f.sku),
    });
    return NextResponse.json(
      {
        error: failed.some((f) => f.error === "Data komposisi tidak tersedia")
          ? "COMPOSITION_MISSING"
          : "STOCK_CHANGED",
        lines: check.lines,
      },
      { status: 409 },
    );
  }

  const products = findProductsBySkus(rawItems.map((i) => i.sku));
  const items: OrderItem[] = rawItems.map((line) => {
    const product = products.find((p) => p.sku === line.sku)!;
    return {
      sku: product.sku,
      name: product.name,
      qty: line.qty,
      priceIdr: product.priceIdr,
    };
  });

  const courier = body.shipping?.courier ?? "sicepat";
  const costIdr =
    typeof body.shipping?.costIdr === "number"
      ? body.shipping.costIdr
      : COURIER_COST[courier] ?? 18000;

  const ref = nextOrderRef();
  const order = buildOrder({
    ref,
    customer: {
      name: body.customer?.name?.trim() || "Pelanggan",
      phone: body.customer?.phone?.trim() || "+62 812 0000 0000",
      email: body.customer?.email?.trim() || "pelanggan@example.test",
    },
    shipping: {
      address: body.shipping?.address?.trim() || "Jl. Contoh No. 1",
      city: body.shipping?.city?.trim() || "Bogor",
      postalCode: body.shipping?.postalCode?.trim() || "16111",
      courier,
      service: body.shipping?.service ?? "REG",
      costIdr,
    },
    items,
  });

  /* ------------------------------------------------------------- Jalur B ---
   * Order dikirim ke ERP (Modul 4.2 Order & Status) SEBELUM diumumkan sukses.
   * Urutannya disengaja: kalau ERP menolak, pelanggan tidak pernah menerima
   * nomor pesanan yang tidak ada di sistem gudang.
   */
  const erp = resolveErpOrderConfig();
  let erpSynced = false;

  if (erp.mode === "push") {
    const result = await pushOrder(erp, order);
    applyErpPush(order, result);
    erpSynced = result.ok;

    pushTelemetry({
      event: result.ok ? "erp_order_pushed" : "erp_order_failed",
      ref: order.ref,
      contract: result.contract ?? null,
      erp_id: result.erpId ?? null,
      status: result.rawStatus ?? null,
      error: result.error ?? null,
    });

    if (!result.ok && erp.strict) {
      return NextResponse.json(
        {
          error: "ERP_REJECTED",
          message:
            "Pesanan tidak bisa dicatat di ERP, jadi checkout dibatalkan. " +
            "Tidak ada nomor pesanan yang dibuat.",
          contract: result.contract ?? null,
          erp: {
            base_url: erp.baseUrl,
            error: result.error ?? null,
            http_status: result.httpStatus ?? null,
          },
        },
        { status: 502 },
      );
    }
  }

  /* Penjualan mengurangi stok. Dua jalur, dipilih lewat OSR_ERP_STOCK_OVERLAY:
   *
   *   webhook (default) → kirim `stock.updated` ke ERP
   *                       (`POST /api/webhooks/wms`), ERP yang mengurangi stok
   *                       sehingga angka di ERP tetap sumber kebenaran.
   *   local             → ERP tidak disentuh; storefront menyimpan overlay
   *                       "terjual" in-memory di atas snapshot (dipakai kalau
   *                       webhook ERP dimatikan).
   *
   * Overlay lokal tetap dicatat untuk tampilan supaya angka langsung turun
   * tanpa menunggu `erp:sync` berikutnya.
   */
  const stockEvents: Array<{ sku: string; delta: number; ok: boolean; error: string | null }> = [];

  for (const item of items) {
    const product = findProduct(item.sku);
    if (!product) continue;

    const lines = product.isBundle
      ? product.components.map((c) => ({
          sku: c.materialCode,
          delta: c.multiplierQty * item.qty,
        }))
      : [{ sku: product.materialCode ?? product.sku, delta: item.qty }];

    for (const line of lines) {
      addSold(line.sku, line.delta);
      if (erp.mode === "push" && erpSynced && erp.stockOverlay === "webhook") {
        const res = await pushStockUpdated(erp, line.sku, line.delta);
        stockEvents.push({
          sku: line.sku,
          delta: line.delta,
          ok: res.ok && res.applied !== false,
          error: res.error ?? null,
        });
      }
    }

    /* Bundle juga punya overlay sendiri (kunci = SKU bundle) untuk mode AS-IS. */
    if (product.isBundle) addSold(product.sku, item.qty);
  }

  rememberOrder(order);
  pushTelemetry({
    event: "order_created",
    ref: order.ref,
    total: order.totalIdr,
    items: items.length,
    idempotency_key: body.idempotency_key ?? null,
    erp_synced: erpSynced,
  });

  return NextResponse.json({
    ok: true,
    ref: order.ref,
    token: signOrder(order),
    order,
    integration: {
      lane: "4.2",
      mode: erp.mode,
      synced: erpSynced,
      contract: order.erp?.contract ?? null,
      erp_id: order.erp?.erpId ?? null,
      erp_status: order.erp?.rawStatus ?? null,
      error: order.erp?.error ?? null,
      // Order tetap diterima walau ERP down selama mode tidak strict.
      degraded: erp.mode === "push" && !erpSynced,
      stock_overlay: erp.stockOverlay,
      stock_events: stockEvents,
    },
  });
}