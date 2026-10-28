import Link from "next/link";
import type { Gender } from "@/lib/types";
import { listProducts } from "@/lib/core";
import { getSegments } from "@/lib/catalog";
import { ProductGrid } from "@/components/ProductCard";
import { GenderFilter } from "@/components/GenderFilter";
import { Pagination } from "@/components/Pagination";
import { formatNumber } from "@/lib/format";

type SearchParams = {
  gender?: string;
  q?: string;
  page?: string;
  sort?: string;
  collection?: string;
};

const SORTS = [
  { key: "featured", label: "Kurasi" },
  { key: "price-asc", label: "Harga terendah" },
  { key: "price-desc", label: "Harga tertinggi" },
  { key: "stock-desc", label: "Stok terbanyak" },
];

export default function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const gender = (searchParams.gender as Gender | undefined) ?? "ALL";
  const page = Number(searchParams.page ?? "1") || 1;
  const sort = (searchParams.sort as "featured" | "price-asc" | "price-desc" | "stock-desc") ?? "featured";

  const result = listProducts({
    gender,
    q: searchParams.q,
    page,
    perPage: 48,
    sort,
    collection: searchParams.collection,
  });

  const query = {
    gender: searchParams.gender,
    q: searchParams.q,
    sort: searchParams.sort === "featured" ? undefined : searchParams.sort,
  };

  return (
    <div className="py-10">
      <div className="flex flex-col gap-4 border-b border-ink/10 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest2 text-smoke">Shop</p>
          <h1 className="mt-2 font-display text-4xl">Katalog Produk</h1>
          <p className="mt-2 text-xs text-smoke">
            {formatNumber(result.total)} SKU cocok · halaman {result.page} dari{" "}
            {result.totalPages}
          </p>
        </div>

        <form action="/shop" className="flex w-full max-w-md gap-2 md:w-auto">
          {searchParams.gender ? (
            <input type="hidden" name="gender" value={searchParams.gender} />
          ) : null}
          <input
            className="input"
            type="search"
            name="q"
            placeholder="Cari nama atau SKU…"
            defaultValue={searchParams.q ?? ""}
          />
          <button className="btn-ghost whitespace-nowrap" type="submit">
            Cari
          </button>
        </form>
      </div>

      <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <GenderFilter
          active={(searchParams.gender as Gender | undefined) ?? "ALL"}
          basePath="/shop"
          extraQuery={{ q: searchParams.q }}
          options={getSegments()
            .slice(0, 10)
            .map((s) => ({
              key: s.key,
              label: `${s.key} (${s.total})`,
            }))}
          label="Brand"
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] uppercase tracking-widest2 text-smoke">Urutkan</span>
          {SORTS.map((s) => {
            const params = new URLSearchParams();
            if (searchParams.gender) params.set("gender", searchParams.gender);
            if (searchParams.q) params.set("q", searchParams.q);
            if (s.key !== "featured") params.set("sort", s.key);
            const qs = params.toString();
            return (
              <Link
                key={s.key}
                href={`/shop${qs ? `?${qs}` : ""}`}
                className={`border px-3 py-1.5 text-[10px] uppercase tracking-widest2 ${
                  sort === s.key
                    ? "border-ink bg-ink text-white"
                    : "border-ink/15 text-smoke hover:border-ink hover:text-ink"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        {result.items.length === 0 ? (
          <div className="border border-ink/15 bg-bone p-10 text-center">
            <p className="font-display text-2xl">Tidak ada produk</p>
            <p className="mt-2 text-xs text-smoke">
              Coba kata kunci lain atau reset filter gender.
            </p>
            <Link href="/shop" className="btn-ghost mt-5">
              Reset filter
            </Link>
          </div>
        ) : (
          <ProductGrid products={result.items} />
        )}
      </div>

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        basePath="/shop"
        query={query}
      />
    </div>
  );
}