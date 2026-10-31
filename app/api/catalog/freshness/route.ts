import { NextResponse } from "next/server";
import { stockFreshness, liveStock } from "@/lib/erp/live-stock";
import { catalogSource } from "@/lib/erp/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/freshness
 *
 * Bukti kesegaran data (A-01/A-04). Tanpa endpoint ini, klaim "katalog ikut ERP"
 * hanya bisa dipercaya; dengan endpoint ini bisa diukur dari luar: jam ERP,
 * jam tarik terakhir, umur cache, jumlah SKU yang ikut overlay.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const wait = Math.min(3000, Number(url.searchParams.get("wait") ?? "2000") || 2000);
  await liveStock(wait);
  const freshness = await stockFreshness(0);
  return NextResponse.json({
    ok: true,
    catalog_source: catalogSource(),
    stock_overlay: freshness,
  });
}
