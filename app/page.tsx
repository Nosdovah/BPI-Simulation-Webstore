import Link from "next/link";
import { featuredProducts, catalogStats, getProductDetail } from "@/lib/core";
import { getCatalogMeta, getCollections, flagshipSku } from "@/lib/catalog";
import { ProductGrid } from "@/components/ProductCard";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const featured = featuredProducts(8);
  const stats = catalogStats();

  // Semua teks hero & kategori diturunkan dari master data ERP — tidak ada
  // nama produk / kategori yang dipaku di kode.
  const meta = getCatalogMeta();
  const collections = getCollections();
  const heroSku = flagshipSku();
  const hero = heroSku ? getProductDetail(heroSku) : null;

  const marquee = [
    "KOLEKSI TERBARU",
    ...collections.slice(0, 3).map((c) => `${c.title.toUpperCase()} · ${formatNumber(c.total)} SKU`),
    "STOK DIPERBARUI OTOMATIS",
    "BUNDLING HEMAT",
  ];

  return (
    <div>
      {/* HERO */}
      <section className="relative mt-4 overflow-hidden">
        <div
          className="relative flex min-h-[440px] items-end"
          style={{
            background:
              "linear-gradient(120deg, #0b2a3a 0%, #12475f 38%, #3a5a86 68%, #6a5b8f 100%)",
          }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(90% 70% at 78% 30%, rgba(255,255,255,0.22), rgba(255,255,255,0) 60%)",
            }}
          />
          <div className="relative z-10 max-w-xl px-6 py-12 sm:px-12">
            <p className="text-[10px] uppercase tracking-widest2 text-white/70">
              Koleksi terbaru · {formatNumber(meta.counts.products)} produk
            </p>
            <h1 className="mt-3 font-display text-4xl leading-[1.05] text-white sm:text-5xl">
              {hero ? hero.name : "Katalog belum tersedia"}
            </h1>
            <p className="mt-4 max-w-md text-xs leading-relaxed text-white/75">
              Katalog, harga, dan ketersediaan stok diperbarui otomatis dari sistem
              inventori. Setiap paket bundling dihitung dari ketersediaan
              komponennya, jadi jumlah yang tampil selalu bisa dikirim.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {hero ? (
                <Link
                  href={`/product/${encodeURIComponent(hero.sku)}`}
                  className="inline-flex items-center bg-white px-6 py-3 text-[11px] uppercase tracking-widest2 text-ink hover:bg-bone"
                >
                  Lihat produk unggulan
                </Link>
              ) : null}
              <Link
                href="/shop"
                className="inline-flex items-center border border-white/50 px-6 py-3 text-[11px] uppercase tracking-widest2 text-white hover:bg-white/10"
              >
                Lihat semua produk
              </Link>
            </div>
          </div>

          {/* siluet perangkat dekoratif */}
          <div className="pointer-events-none absolute bottom-0 right-6 hidden items-end gap-3 sm:flex">
            {[
              { h: 210, hue: 205 },
              { h: 260, hue: 268 },
            ].map((b, i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="h-4 w-7 rounded-sm bg-white/25" />
                <div className="mt-0.5 h-3 w-4 bg-white/40" />
                <div
                  className="rounded-md border border-white/30"
                  style={{
                    height: b.h,
                    width: 74,
                    background: `linear-gradient(180deg, hsla(${b.hue},55%,65%,0.55), hsla(${b.hue},45%,35%,0.75))`,
                    backdropFilter: "blur(2px)",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COLLECTION TILES — diturunkan dari item_type ERP */}
      <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {collections.slice(0, 3).map((c) => (
          <Link
            key={c.slug}
            href={`/collections/${c.slug}`}
            className="group flex h-28 flex-col items-center justify-center bg-mist transition-colors hover:bg-bone"
          >
            <span className="font-display text-2xl tracking-wide">{c.title}</span>
            <span className="mt-1 text-[9px] uppercase tracking-widest2 text-smoke">
              {formatNumber(c.total)} SKU
            </span>
          </Link>
        ))}
      </section>

      {/* TEXT MARQUEE */}
      <section className="mt-3 overflow-hidden border-y border-ink/10 py-3">
        <div className="marquee-track">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex shrink-0">
              {marquee.map((t, i) => (
                <span
                  key={`${dup}-${i}`}
                  className="whitespace-nowrap px-5 text-[12px] uppercase tracking-widest2 text-ink/70"
                >
                  {t} <span className="text-brass">•</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* OUR PRODUCTS */}
      <section className="mt-14">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-display text-3xl">Our Products</h2>
            <p className="mt-1 text-[10px] uppercase tracking-widest2 text-smoke">
              {formatNumber(stats.totalSkus)} SKU · {formatNumber(stats.singles)} satuan ·{" "}
              {formatNumber(stats.bundles)} paket
            </p>
          </div>
          <Link href="/shop" className="nav-link underline underline-offset-8">
            View all products
          </Link>
        </div>

        <div className="mt-6">
          <ProductGrid products={featured} />
        </div>
      </section>

      {/* VALUE PROPS */}
      <section className="mt-16 grid gap-4 border border-ink/15 bg-bone p-6 sm:grid-cols-3">
        {[
          {
            title: "Stok akurat",
            body: "Angka ketersediaan mengikuti sisa komponen nyata, bukan kuota manual — tidak ada pesanan yang batal karena oversold.",
          },
          {
            title: "Status transparan",
            body: "Sepuluh tahap status pesanan diperbarui otomatis dari gudang sampai diterima.",
          },
          {
            title: "Pengiriman terlacak",
            body: "Nomor resi terbit begitu paket diserahkan ke kurir dan bisa dilacak kapan saja.",
          },
        ].map((item) => (
          <div key={item.title}>
            <p className="text-[10px] uppercase tracking-widest2 text-smoke">{item.title}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink/75">{item.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}