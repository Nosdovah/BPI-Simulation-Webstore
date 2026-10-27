import { NextResponse } from "next/server";
import { deriveStatus, readOrderToken, recallOrder } from "@/lib/orders";

/** GET /api/orders/[ref]?k=token — status + timeline (Jalur B). */
export async function GET(
  request: Request,
  { params }: { params: { ref: string } },
) {
  const url = new URL(request.url);
  const token = url.searchParams.get("k");
  const order = recallOrder(params.ref) ?? readOrderToken(token);

  if (!order) {
    return NextResponse.json(
      { error: "ORDER_NOT_FOUND", message: "Order tidak ditemukan atau token tidak valid." },
      { status: 404 },
    );
  }

  const derived = deriveStatus(order);

  return NextResponse.json({
    ref: order.ref,
    mode: order.mode,
    status: derived.status,
    stuck: derived.stuck,
    note: derived.note,
    trackingNo: derived.trackingNo,
    actorLast: order.actorLast,
    createdAt: order.createdAt,
    timeline: derived.timeline,
    items: order.items,
    totalIdr: order.totalIdr,
    customer: order.customer,
    shipping: order.shipping,
  });
}