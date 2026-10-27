import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listProducts } from "@/lib/core";
import { MODE_COOKIE, parseMode } from "@/lib/state";
import type { Gender } from "@/lib/types";

/**
 * GET /api/catalog/products?gender=&q=&page=&perPage=&collection=
 * Read model ramping untuk storefront (Jalur A).
 */
export async function GET(request: Request) {
  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const perPage = Math.min(96, Number(url.searchParams.get("perPage") ?? "48") || 48);

  const result = listProducts({
    mode,
    gender: (url.searchParams.get("gender") as Gender | null) ?? "ALL",
    collection: url.searchParams.get("collection") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    page,
    perPage,
    sort: (url.searchParams.get("sort") as "featured" | "price-asc" | "price-desc" | "stock-desc") ?? "featured",
  });

  return NextResponse.json(result);
}