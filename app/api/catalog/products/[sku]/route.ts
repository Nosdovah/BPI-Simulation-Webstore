import { NextResponse } from "next/server";
import { getProductDetail } from "@/lib/core";
import { pushTelemetry } from "@/lib/state";

/** GET /api/catalog/products/[sku] — detail + komposisi. */
export async function GET(
  _request: Request,
  { params }: { params: { sku: string } },
) {
  const detail = getProductDetail(decodeURIComponent(params.sku));
  if (!detail) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  pushTelemetry({ event: "product_view", sku: detail.sku });
  return NextResponse.json({ product: detail });
}