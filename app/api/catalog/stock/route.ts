import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { checkStock, getProductDetail } from "@/lib/core";
import { MODE_COOKIE, parseMode, pushTelemetry } from "@/lib/state";

/**
 * GET /api/catalog/stock?skus=A,B,C
 * Kontrak blueprint §5: storefront tidak menghitung stok sendiri.
 */
export async function GET(request: Request) {
  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);
  const url = new URL(request.url);
  const skus = (url.searchParams.get("skus") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);

  if (skus.length === 0) {
    return NextResponse.json({ mode, items: [] });
  }

  const items = skus.map((sku) => {
    const detail = getProductDetail(sku, mode);
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

  const check = checkStock(
    skus.map((sku) => ({ sku, qty: 1 })),
    mode,
  );

  pushTelemetry({ event: "stock_check", mode, skus: skus.length });

  return NextResponse.json({ mode, items, check: check.lines });
}