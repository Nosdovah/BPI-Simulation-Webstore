import { NextResponse } from "next/server";
import { readOrderToken, recallOrder, rememberOrder } from "@/lib/orders";

/**
 * POST /api/orders/[ref]/manual
 * Meniru kebiasaan baseline: staff mengubah status dengan klik manual di WMS,
 * bukan lewat sinkronisasi webhook.
 */
export async function POST(
  request: Request,
  { params }: { params: { ref: string } },
) {
  const url = new URL(request.url);
  const token = url.searchParams.get("k");
  const order = recallOrder(params.ref) ?? readOrderToken(token);

  if (!order) {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  order.status = "COMPLETED";
  order.actorLast = "STAFF";
  order.trackingNo = order.trackingNo ?? `MANUAL-${params.ref.slice(-4)}`;
  order.note = "Status diubah lewat klik manual staff — bukan hasil sinkronisasi webhook.";
  rememberOrder(order);

  return NextResponse.json({ ok: true, status: order.status, actorLast: order.actorLast });
}