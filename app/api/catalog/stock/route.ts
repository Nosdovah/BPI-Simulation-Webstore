import { NextResponse } from "next/server";
import { checkStock, getProductDetail } from "@/lib/core";
import { liveStock } from "@/lib/erp/live-stock";
import { stockMode, type StockMode } from "@/lib/stock";
import { pushTelemetry } from "@/lib/state";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/stock?skus=A,B,C&stock=as-is|to-be
 *
 * Storefront tidak menghitung stok sendiri — angka berasal dari core.
 *
 * Temuan A-07: versi sebelumnya mengabaikan mode stok sama sekali, sehingga
 * SKU BUNDLE selalu dijawab dengan angka AS-IS walaupun pemanggil meminta
 * kapasitas BOM. Sekarang `?stock=` dihormati di sini DAN diteruskan ke
 * `checkStock`, supaya angka tampilan dan hasil validasi tidak pernah berbeda
 * (klien menyetujui apa yang server setujui).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const skus = (url.searchParams.get("skus") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);

  const modeParam = url.searchParams.get("stock");
  const mode: StockMode | undefined =
    modeParam === "to-be" ? "to-be" : modeParam === "as-is" ? "as-is" : undefined;
  const effectiveMode: StockMode = mode ?? stockMode();

  if (skus.length === 0) {
    return NextResponse.json({ items: [], stockMode: effectiveMode });
  }

  // Angka live: tunggu maksimal 2 detik, sama seperti route katalog.
  const live = await liveStock(2000);

  const items = skus.map((sku) => {
    const detail = getProductDetail(sku, effectiveMode);
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
      bundleComponents: detail.bundleComponents,
    };
  });

  const check = checkStock(skus.map((sku) => ({ sku, qty: 1 })), effectiveMode);

  pushTelemetry({ event: "stock_check", skus: skus.length });

  return NextResponse.json({
    items,
    check: check.lines,
    stockMode: effectiveMode,
    stockOverlay: {
      source: live.index ? "erp-live" : "snapshot",
      fresh: live.fresh,
      age_seconds: live.ageMs === null ? null : Math.round(live.ageMs / 1000),
      sku_count: live.index ? live.index.size : 0,
      error: live.lastError,
    },
  });
}