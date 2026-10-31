import { NextResponse } from "next/server";
import { listProducts } from "@/lib/core";
import { liveStock, stockFreshness } from "@/lib/erp/live-stock";
import { liveCatalog } from "@/lib/erp/live-catalog";
import type { Gender } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/products?gender=&q=&page=&perPage=&collection=
 *
 * Read model untuk storefront. Angka stok berasal dari overlay ERP live
 * (`/api/webhooks/stock-index`, TTL 30 dtk) dengan snapshot sebagai cadangan;
 * master data (nama, komposisi BOM, gambar) tetap dari snapshot ber-checksum.
 *
 * Respons selalu menyertakan `freshness` supaya umur data bisa diaudit dari
 * luar tanpa membuka dashboard — ini yang membuat klaim "katalog live" bisa
 * dibuktikan, bukan dipercaya.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const perPage = Math.min(96, Number(url.searchParams.get("perPage") ?? "48") || 48);

  // Tunggu maksimal 2 detik: request pertama setelah cold start tetap dapat
  // angka live, tetapi tidak menggantung kalau ERP lambat/down.
  // Master (nama/harga) + stok dipanaskan bersamaan — dua overlay, satu ERP.
  await Promise.all([liveStock(2000), liveCatalog(2000)]);

  const result = listProducts({
    gender: (url.searchParams.get("gender") as Gender | null) ?? "ALL",
    collection: url.searchParams.get("collection") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    page,
    perPage,
    sort: (url.searchParams.get("sort") as "featured" | "price-asc" | "price-desc" | "stock-desc") ?? "featured",
    // `?stock=to-be` menampilkan kapasitas turunan BOM (TO-BE) tanpa mengubah
    // tampilan default AS-IS — ini yang dipakai demo before→after DMAIC.
    stockMode: url.searchParams.get("stock") === "to-be" ? "to-be" : url.searchParams.get("stock") === "as-is" ? "as-is" : undefined,
  });

  const freshness = await stockFreshness(0);

  return NextResponse.json({ ...result, freshness });
}
