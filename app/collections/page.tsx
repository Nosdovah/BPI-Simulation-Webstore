import Link from "next/link";
import { getCollections, getCatalogMeta } from "@/lib/catalog";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function CollectionsIndexPage() {
  const collections = getCollections();
  const meta = getCatalogMeta();

  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Collections</p>
        <h1 className="mt-2 font-display text-4xl">Koleksi dari master data ERP</h1>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-smoke">
          Koleksi di bawah ini diturunkan dari field <code className="font-mono">item_type</code>{" "}
          pada master produk ERP — bukan daftar tetap di kode. Sumber:{" "}
          {meta.baseUrl} · snapshot {new Date(meta.fetchedAt).toLocaleString("id-ID")} ·
          checksum <code className="font-mono">{meta.checksum.slice(0, 12)}</code>
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {collections.map((c) => (
          <Link
            key={c.slug}
            href={`/collections/${c.slug}`}
            className="group border border-ink/15 p-6 transition-colors hover:border-ink"
          >
            <p className="font-display text-2xl">{c.title}</p>
            <p className="mt-2 text-[10px] uppercase tracking-widest2 text-smoke">
              {formatNumber(c.total)} SKU
            </p>
            <p className="mt-3 text-xs leading-relaxed text-ink/70">{c.subtitle}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}