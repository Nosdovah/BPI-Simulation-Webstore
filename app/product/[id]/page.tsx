import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductDetail } from "@/lib/core";
import { formatIdr, formatNumber } from "@/lib/format";
import { ProductImage } from "@/components/ProductImage";
import { StockBadge } from "@/components/StockBadge";
import { AddToCart } from "@/components/AddToCart";
import { BundleComposition } from "@/components/BundleComposition";

export default function ProductPage({ params }: { params: { id: string } }) {
  const product = getProductDetail(decodeURIComponent(params.id));
  if (!product) notFound();

  const soldOut = product.stockError !== null || (product.stockDisplay ?? 0) <= 0;

  return (
    <div className="py-8">
      <nav className="text-[10px] uppercase tracking-widest2 text-smoke">
        <Link href="/" className="hover:text-ink">Home</Link>
        <span className="px-2">/</span>
        <Link href="/shop" className="hover:text-ink">Shop</Link>
        <span className="px-2">/</span>
        <span className="text-ink">{product.sku}</span>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <div>
          <ProductImage
            imageKey={product.imageKey}
            name={product.name}
            isBundle={product.isBundle}
            size="lg"
            className="aspect-[4/5] w-full"
          />
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <ProductImage
                key={i}
                imageKey={`${product.imageKey}-${i}`}
                name={product.name}
                className="aspect-square w-full opacity-80"
                size="sm"
              />
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest2 text-smoke">
            {product.gender} · {product.collection.replace(/-/g, " ")} · {product.sizeLabel}
          </p>
          <h1 className="mt-2 font-display text-4xl leading-tight">{product.name}</h1>

          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-lg">{formatIdr(product.priceIdr)}</span>
            {product.compareAtIdr ? (
              <span className="text-sm text-smoke line-through">
                {formatIdr(product.compareAtIdr)}
              </span>
            ) : null}
            <span className="text-[10px] uppercase tracking-widest2 text-smoke">
              {product.isBundle ? "Paket bundling" : product.sizeLabel}
            </span>
          </div>

          <div className="mt-4">
            <StockBadge
              value={product.stockDisplay}
              label={product.stockLabel}
              error={product.stockError}
              aware={product.stockAware}
            />
          </div>

          <div className="mt-6">
            <AddToCart
              sku={product.sku}
              disabled={soldOut}
              disabledReason={product.stockError ? "Komposisi tidak tersedia" : "Habis"}
              maxQty={product.stockDisplay}
            />
          </div>

          <div className="mt-6 border border-ink/10 bg-bone p-4">
            <p className="text-[10px] uppercase tracking-widest2 text-smoke">
              Ketersediaan
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink/75">
              {product.isBundle
                ? "Stok paket dihitung dari komponen yang paling terbatas dan ikut turun setiap komponen terjual, sehingga jumlah yang bisa dipesan selalu sesuai sisa bahan."
                : "Stok satuan mengikuti sisa persediaan yang tercatat di sistem inventori dan diperbarui setiap ada penjualan."}
            </p>
          </div>

          {product.isBundle ? (
            <div className="mt-6">
              <BundleComposition components={product.bundleComponents} />
            </div>
          ) : null}

          <div className="mt-8 space-y-6">
            <section>
              <h2 className="text-[10px] uppercase tracking-widest2 text-smoke">Deskripsi</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink/80">{product.description}</p>
            </section>

            <section>
              <h2 className="text-[10px] uppercase tracking-widest2 text-smoke">Atribut produk</h2>
              <dl className="mt-2 grid grid-cols-3 gap-4 text-xs">
                <div>
                  <dt className="text-smoke">Brand</dt>
                  <dd className="mt-1">{product.notes.top.join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-smoke">Kategori</dt>
                  <dd className="mt-1">{product.notes.heart.join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-smoke">Garansi</dt>
                  <dd className="mt-1">{product.notes.base.join(", ")}</dd>
                </div>
              </dl>
            </section>

            {product.stockPerWarehouse.length > 0 ? (
              <section>
                <h2 className="text-[10px] uppercase tracking-widest2 text-smoke">Stok per gudang</h2>
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {product.stockPerWarehouse.map((w) => (
                      <tr key={w.warehouseId} className="border-t border-ink/5">
                        <td className="py-2">{w.warehouseName}</td>
                        <td className="py-2 text-right">{formatNumber(w.available)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[10px] text-smoke">
                  Angka per gudang adalah jumlah tersedia setelah dikurangi pesanan yang
                  sedang diproses.
                </p>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}