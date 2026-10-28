import { NextResponse } from "next/server";
import { addSold, pushTelemetry } from "@/lib/state";
import { findProductsBySkus, findProduct } from "@/lib/catalog";
import { checkStock } from "@/lib/core";
import { buildOrder, nextOrderRef, rememberOrder, signOrder } from "@/lib/orders";
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

  // Penjualan mengurangi stok komponen sehingga angka paket ikut turun.
  for (const item of items) {
    const product = findProduct(item.sku);
    if (!product) continue;
    if (product.isBundle) {
      for (const comp of product.components) {
        addSold(comp.materialCode, comp.multiplierQty * item.qty);
      }
    } else if (product.materialCode) {
      addSold(product.materialCode, item.qty);
    }
  }

  rememberOrder(order);
  pushTelemetry({
    event: "order_created",
    ref: order.ref,
    total: order.totalIdr,
    items: items.length,
    idempotency_key: body.idempotency_key ?? null,
  });

  return NextResponse.json({
    ok: true,
    ref: order.ref,
    token: signOrder(order),
    order,
  });
}