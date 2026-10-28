import { NextResponse } from "next/server";
import { checkStock, getProductDetail } from "@/lib/core";
import { pushTelemetry } from "@/lib/state";

/**
 * GET /api/catalog/stock?skus=A,B,C
 * Storefront tidak menghitung stok sendiri — angka berasal dari core.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const skus = (url.searchParams.get("skus") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);

  if (skus.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const items = skus.map((sku) => {
    const detail = getProductDetail(sku);
    if (!detail) return { sku, found: false };
    return {
      sku: detail.sku,
      found: true,
      name: detail.name,
      slug: detail.slug,
      priceIdr: detail.priceIdr,
      imageKey: detail.imageKey,
      isBundle: detail.isBundle,
      sizeLabel: detail.sizeLabel,
      stockDisplay: detail.stockDisplay,
      stockLabel: detail.stockLabel,
      stockError: detail.stockError,
      stockAware: detail.stockAware,
    };
  });

  const check = checkStock(skus.map((sku) => ({ sku, qty: 1 })));

  pushTelemetry({ event: "stock_check", skus: skus.length });

  return NextResponse.json({ items, check: check.lines });
}