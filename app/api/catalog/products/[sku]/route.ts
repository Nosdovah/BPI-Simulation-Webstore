import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getProductDetail } from "@/lib/core";
import { MODE_COOKIE, parseMode, pushTelemetry } from "@/lib/state";

/** GET /api/catalog/products/[sku] — detail + komposisi (Jalur A). */
export async function GET(
  _request: Request,
  { params }: { params: { sku: string } },
) {
  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);
  const detail = getProductDetail(decodeURIComponent(params.sku), mode);
  if (!detail) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  pushTelemetry({ event: "product_view", mode, sku: detail.sku });
  return NextResponse.json({ mode, product: detail });
}