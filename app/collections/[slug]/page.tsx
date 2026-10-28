import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getCollections, getSegments } from "@/lib/catalog";
import { listProducts } from "@/lib/core";
import { MODE_COOKIE, parseMode } from "@/lib/state";
import { ProductGrid } from "@/components/ProductCard";
import { GenderFilter } from "@/components/GenderFilter";
import { Pagination } from "@/components/Pagination";
import { formatNumber } from "@/lib/format";
import type { Gender } from "@/lib/types";

export default function CollectionPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { gender?: string; page?: string };
}) {
  const collection = getCollections().find((c) => c.slug === params.slug);
  if (!collection) notFound();

  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);
  const gender = (searchParams.gender as Gender | undefined) ?? "ALL";
  const page = Number(searchParams.page ?? "1") || 1;

  const result = listProducts({
    mode,
    gender,
    collection: collection.slug,
    page,
    perPage: 48,
  });

  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Collections</p>
        <h1 className="mt-2 font-display text-4xl">{collection.title}</h1>
        <p className="mt-2 text-xs text-smoke">
          {collection.subtitle} · {formatNumber(result.total)} SKU
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {getCollections().map((c) => (
          <Link
            key={c.slug}
            href={`/collections/${c.slug}`}
            className={`border px-4 py-2 text-[10px] uppercase tracking-widest2 ${
              c.slug === collection.slug
                ? "border-ink bg-ink text-white"
                : "border-ink/15 text-smoke hover:border-ink hover:text-ink"
            }`}
          >
            {c.title}
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <GenderFilter
          active={gender}
          basePath={`/collections/${collection.slug}`}
          options={getSegments()
            .slice(0, 8)
            .map((s) => ({ key: s.key, label: `${s.key} (${s.total})` }))}
          label="Brand"
        />
      </div>

      <div className="mt-8">
        <ProductGrid products={result.items} mode={mode} />
      </div>

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        basePath={`/collections/${collection.slug}`}
        query={{ gender: searchParams.gender }}
      />
    </div>
  );
}