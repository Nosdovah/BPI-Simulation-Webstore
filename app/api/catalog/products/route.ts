import { NextResponse } from "next/server";
import { listProducts } from "@/lib/core";
import type { Gender } from "@/lib/types";

/**
 * GET /api/catalog/products?gender=&q=&page=&perPage=&collection=
 * Read model untuk storefront.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const perPage = Math.min(96, Number(url.searchParams.get("perPage") ?? "48") || 48);

  const result = listProducts({
    gender: (url.searchParams.get("gender") as Gender | null) ?? "ALL",
    collection: url.searchParams.get("collection") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    page,
    perPage,
    sort: (url.searchParams.get("sort") as "featured" | "price-asc" | "price-desc" | "stock-desc") ?? "featured",
  });

  return NextResponse.json(result);
}