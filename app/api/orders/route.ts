import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { addSold, MODE_COOKIE, parseMode, pushTelemetry } from "@/lib/state";
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
  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);
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

  // Validasi ulang di core — bukan di UI (blueprint §6.3)
  const check = checkStock(rawItems, mode);
  if (!check.ok) {
    const failed = check.lines.filter((l) => !l.ok);
    pushTelemetry({
      event: "stock_reject",
      mode,
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
    mode,
    customer: {
      name: body.customer?.name?.trim() || "Pelanggan Simulasi",
      phone: body.customer?.phone?.trim() || "+62 812 0000 0000",
      email: body.customer?.email?.trim() || "pelanggan@example.test",
    },
    shipping: {
      address: body.shipping?.address?.trim() || "Jl. Simulasi No. 1",
      city: body.shipping?.city?.trim() || "Bogor",
      postalCode: body.shipping?.postalCode?.trim() || "16111",
      courier,
      service: body.shipping?.service ?? "REG",
      costIdr,
    },
    items,
  });

  // Di to-be, penjualan mengurangi stok komponen sehingga angka bundle turun.
  // Di baseline, tidak ada pengurangan sama sekali — kuota statis tetap.
  if (mode === "tobe") {
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
  }

  rememberOrder(order);
  pushTelemetry({
    event: "order_created",
    mode,
    ref: order.ref,
    total: order.totalIdr,
    items: items.length,
    idempotency_key: body.idempotency_key ?? null,
  });

  return NextResponse.json({
    ok: true,
    mode,
    ref: order.ref,
    token: signOrder(order),
    order,
  });
}