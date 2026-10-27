import Link from "next/link";
import { cookies } from "next/headers";
import { featuredProducts, catalogStats } from "@/lib/core";
import { MODE_COOKIE, parseMode } from "@/lib/state";
import { ProductGrid } from "@/components/ProductCard";
import { formatNumber } from "@/lib/format";

const CATEGORIES = [
  { key: "MEN", label: "Men", note: "Woody · aromatic · bold" },
  { key: "UNISEX", label: "Unisex", note: "Shared · modern · clean" },
  { key: "WOMEN", label: "Women", note: "Floral · gourmand · soft" },
];

const MARQUEE = [
  "DISCOVER YOUR SIGNATURE SCENT",
  "LUXURY FRAGRANCES // BEST PRICES",
  "AUTHENTIC DESIGNER PERFUMES",
  "NEW ARRIVALS EVERY WEEK",
  "EXCLUSIVE FRAGRANCE COLLECTIONS",
  "CAPTIVATE WITH EVERY SPRAY",
  "ENDLESS POSSIBILITIES AWAITS",
];

export default function HomePage() {
  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);
  const featured = featuredProducts(mode, 8);
  const stats = catalogStats(mode);

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
              New launch promotion
            </p>
            <h1 className="mt-3 font-display text-4xl leading-[1.05] text-white sm:text-6xl">
              Sanctum &amp; Noctis
              <br />
              20ml Collection
            </h1>
            <p className="mt-4 max-w-md text-xs leading-relaxed text-white/75">
              Bundling dua varian 20ml dengan harga khusus. Stok terbatas — dan di
              sandbox ini stoknya benar-benar dihitung dari komponen, bukan angka
              manual.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/product/SANCTUM-NOCTIS-20ML-A1"
                className="inline-flex items-center bg-white px-6 py-3 text-[11px] uppercase tracking-widest2 text-ink hover:bg-bone"
              >
                Beli bundling
              </Link>
              <Link
                href="/shop"
                className="inline-flex items-center border border-white/50 px-6 py-3 text-[11px] uppercase tracking-widest2 text-white hover:bg-white/10"
              >
                Lihat semua produk
              </Link>
            </div>
          </div>

          {/* siluet botol dekoratif */}
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

      {/* CATEGORY TILES */}
      <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CATEGORIES.map((c) => (
          <Link
            key={c.key}
            href={`/shop?gender=${c.key}`}
            className="group flex h-28 flex-col items-center justify-center bg-mist transition-colors hover:bg-bone"
          >
            <span className="font-display text-2xl tracking-wide">{c.label}</span>
            <span className="mt-1 text-[9px] uppercase tracking-widest2 text-smoke">
              {c.note}
            </span>
          </Link>
        ))}
      </section>

      {/* TEXT MARQUEE */}
      <section className="mt-3 overflow-hidden border-y border-ink/10 py-3">
        <div className="marquee-track">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex shrink-0">
              {MARQUEE.map((t, i) => (
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
              {formatNumber(stats.totalSkus)} SKU · {formatNumber(stats.singles)} single ·{" "}
              {formatNumber(stats.bundles)} bundling
            </p>
          </div>
          <Link href="/shop" className="nav-link underline underline-offset-8">
            View all products
          </Link>
        </div>

        <div className="mt-6">
          <ProductGrid products={featured} mode={mode} />
        </div>
      </section>

      {/* SIMULATION NOTE */}
      <section className="mt-16 border border-ink/15 bg-bone p-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">
          Catatan simulasi
        </p>
        <div className="mt-3 grid gap-4 text-xs leading-relaxed text-ink/80 md:grid-cols-3">
          <p>
            Mode <strong>baseline</strong> menampilkan kuota stok manual dari WMS 4.1
            apa adanya. Angka tidak pernah turun walau komponennya terjual — di sinilah{" "}
            <strong>{formatNumber(stats.phantomUnits)} unit phantom stock</strong> muncul
            di {formatNumber(stats.phantomSkus)} SKU bundling.
          </p>
          <p>
            Mode <strong>to-be</strong> menghitung stok bundling dari komponen pembatas
            (<code className="font-mono">MIN(FLOOR(stok/qty))</code>) dan menampilkan
            komposisinya.
          </p>
          <p>
            Ganti mode lewat tombol <strong>Baseline / To-Be</strong> di header, lalu buka
            SKU yang sama untuk melihat perbedaan angkanya. Panel lengkap ada di{" "}
            <Link href="/admin/simulasi" className="underline underline-offset-4">
              /admin/simulasi
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}