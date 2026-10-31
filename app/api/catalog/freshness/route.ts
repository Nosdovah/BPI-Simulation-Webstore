import { NextResponse } from "next/server";
import { stockFreshness, liveStock } from "@/lib/erp/live-stock";
import { liveCatalog, catalogFreshnessSync } from "@/lib/erp/live-catalog";
import { catalogSource } from "@/lib/erp/client";
import { getCatalogMeta } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/freshness
 *
 * Bukti kesegaran data (A-01/A-02/A-04). Tanpa endpoint ini, klaim "katalog ikut
 * ERP" hanya bisa dipercaya; dengan endpoint ini bisa diukur dari luar.
 *
 * Temuan A-02: versi lama melaporkan `catalog_source` dari ENV
 * (`OSR_CATALOG_SOURCE`), bukan dari sumber yang benar-benar dipakai. Nilainya
 * bisa "live" sementara render tetap memakai snapshot — laporan yang tidak
 * boleh dipercaya. Sekarang:
 *   catalog.configured → nilai env
 *   catalog.source     → sumber EFEKTIF (erp-live hanya kalau overlay benar-benar terpasang)
 *   catalog.applied_count → berapa field yang berubah pada penerapan terakhir
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const wait = Math.min(3000, Number(url.searchParams.get("wait") ?? "2000") || 2000);
  await Promise.all([liveStock(wait), liveCatalog(wait)]);

  const stock = await stockFreshness(0);
  const catalog = catalogFreshnessSync();
  const meta = getCatalogMeta();

  return NextResponse.json({
    ok: true,
    // dipertahankan untuk kompatibilitas pembaca lama
    catalog_source: catalog.source,
    catalog: {
      configured: catalogSource(),
      source: catalog.source,
      erp_base_url: catalog.erp_base_url,
      fetched_at: catalog.fetched_at,
      age_seconds: catalog.age_seconds,
      ttl_seconds: catalog.ttl_seconds,
      fresh: catalog.fresh,
      sku_count: catalog.sku_count,
      applied_count: catalog.applied_count,
      error: catalog.error,
      snapshot: {
        // umur snapshot yang dibundel saat build — batas bawah kesegaran master
        source: meta.source,
        generated_at: meta.fetchedAt ?? null,
        total_skus: meta.counts?.products ?? null,
        checksum: meta.checksum ?? null,
      },
    },
    stock_overlay: stock,
  });
}