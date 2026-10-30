import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/guard";
import { findProductsBySkus } from "@/lib/catalog";
import { checkStock } from "@/lib/core";
import { pushTelemetry } from "@/lib/state";
import { cartBackend, clampQty, mutateCart, readCart, type CartMutation } from "@/lib/cart-server";
import type { CartLine } from "@/lib/types";

/**
 * /api/cart — keranjang server-side.
 *
 * Semua operasi butuh sesi webstore (cookie `osr_session`). Tamu ditolak 401,
 * bukan diberi keranjang anonim: kebijakan RBAC v1.1 mengunci keranjang untuk
 * tamu, dan keranjang anonim hanya menambah jalur data yang harus dibersihkan.
 *
 * Yang TIDAK dipercaya dari klien:
 *   - harga  → selalu dari katalog ERP (snapshot), bukan dari body
 *   - stok   → divalidasi `checkStock` setiap penambahan
 *   - qty    → dijepit ke 1..99
 *   - isi keranjang saat checkout → dibaca dari server, bukan dari body
 */

export const dynamic = "force-dynamic";

type CartLineView = CartLine & {
  name: string | null;
  slug: string | null;
  priceIdr: number | null;
  lineTotalIdr: number | null;
  isBundle: boolean;
  stock: { ok: boolean; available: number | null; error: string | null };
};

function requireOwner(): { owner: string } | { error: NextResponse } {
  const session = currentSession();
  if (!session) {
    return {
      error: NextResponse.json(
        {
          error: "AUTH_REQUIRED",
          message: "Masuk dulu untuk memakai keranjang.",
        },
        { status: 401 },
      ),
    };
  }
  return { owner: session.uid };
}

/** Tempelkan data katalog ke baris keranjang — satu query untuk semua SKU. */
function decorate(lines: CartLine[]): { lines: CartLineView[]; subtotalIdr: number; count: number } {
  if (lines.length === 0) return { lines: [], subtotalIdr: 0, count: 0 };

  const products = findProductsBySkus(lines.map((l) => l.sku));
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const stockCheck = checkStock(lines);
  const stockBySku = new Map(stockCheck.lines.map((l) => [l.sku, l]));

  const view: CartLineView[] = lines.map((line) => {
    const product = bySku.get(line.sku);
    const stock = stockBySku.get(line.sku);
    const price = product?.priceIdr ?? null;
    return {
      sku: line.sku,
      qty: line.qty,
      name: product?.name ?? null,
      slug: (product as { slug?: string } | undefined)?.slug ?? null,
      priceIdr: price,
      lineTotalIdr: price === null ? null : price * line.qty,
      isBundle: Boolean(product?.isBundle),
      stock: {
        ok: stock?.ok ?? false,
        available: stock?.available ?? null,
        error: stock?.error ?? (product ? null : "SKU tidak ditemukan"),
      },
    };
  });

  return {
    lines: view,
    subtotalIdr: view.reduce((sum, l) => sum + (l.lineTotalIdr ?? 0), 0),
    count: view.reduce((sum, l) => sum + l.qty, 0),
  };
}

export async function GET() {
  const gate = requireOwner();
  if ("error" in gate) return gate.error;

  try {
    const lines = await readCart(gate.owner);
    const payload = decorate(lines);
    return NextResponse.json({
      ok: true,
      backend: cartBackend(),
      ...payload,
    });
  } catch (err) {
    pushTelemetry({ event: "cart_read_failed", error: String(err) });
    return NextResponse.json(
      { error: "CART_BACKEND_ERROR", message: "Keranjang tidak bisa dibaca." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const gate = requireOwner();
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => ({}))) as { sku?: string; qty?: number };
  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  if (!sku) {
    return NextResponse.json({ error: "SKU_REQUIRED" }, { status: 400 });
  }
  if (!findProductsBySkus([sku]).length) {
    return NextResponse.json({ error: "SKU_NOT_FOUND", sku }, { status: 404 });
  }

  const qty = clampQty(body.qty ?? 1);

  // Validasi stok atas TOTAL setelah penambahan, bukan hanya delta-nya.
  try {
    const before = await readCart(gate.owner);
    const existing = before.find((l) => l.sku === sku)?.qty ?? 0;
    const total = Math.min(99, existing + qty);
    const check = checkStock([{ sku, qty: total }]);
    const line = check.lines[0];

    if (line && !line.ok) {
      pushTelemetry({
        event: "cart_stock_reject",
        sku,
        requested: total,
        available: line.available,
        error: line.error,
      });
      return NextResponse.json(
        {
          error: "STOCK_INSUFFICIENT",
          message:
            line.error ??
            `Stok tidak cukup: diminta ${total}, tersedia ${line.available ?? 0}.`,
          line,
        },
        { status: 409 },
      );
    }
  } catch (err) {
    pushTelemetry({ event: "cart_validate_failed", sku, error: String(err) });
    // Validasi gagal bukan alasan menolak pengguna; backend tetap dicoba.
  }

  return applyMutation(gate.owner, { op: "add", sku, qty });
}

export async function PATCH(request: Request) {
  const gate = requireOwner();
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => ({}))) as { sku?: string; qty?: number };
  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  if (!sku) {
    return NextResponse.json({ error: "SKU_REQUIRED" }, { status: 400 });
  }

  const raw = Number(body.qty);
  if (!Number.isFinite(raw)) {
    return NextResponse.json({ error: "QTY_INVALID" }, { status: 400 });
  }

  if (raw <= 0) {
    return applyMutation(gate.owner, { op: "remove", sku });
  }

  const qty = clampQty(raw);

  try {
    const check = checkStock([{ sku, qty }]);
    const line = check.lines[0];
    if (line && !line.ok) {
      return NextResponse.json(
        {
          error: "STOCK_INSUFFICIENT",
          message: line.error ?? `Stok tersedia ${line.available ?? 0}.`,
          line,
        },
        { status: 409 },
      );
    }
  } catch {
    // lanjut
  }

  return applyMutation(gate.owner, { op: "set", sku, qty });
}

export async function DELETE(request: Request) {
  const gate = requireOwner();
  if ("error" in gate) return gate.error;

  const sku = new URL(request.url).searchParams.get("sku")?.trim();
  const action: CartMutation = sku ? { op: "remove", sku } : { op: "clear" };
  return applyMutation(gate.owner, action);
}

async function applyMutation(owner: string, action: CartMutation): Promise<NextResponse> {
  try {
    const lines = await mutateCart(owner, action);
    const payload = decorate(lines);
    return NextResponse.json({
      ok: true,
      backend: cartBackend(),
      action: action.op,
      ...payload,
    });
  } catch (err) {
    pushTelemetry({ event: "cart_write_failed", action: action.op, error: String(err) });
    return NextResponse.json(
      {
        error: "CART_BACKEND_ERROR",
        message: "Keranjang tidak bisa disimpan.",
      },
      { status: 503 },
    );
  }
}