import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getProductDetail } from "@/lib/core";
import { MODE_COOKIE, parseMode } from "@/lib/state";
import { formatIdr, formatNumber } from "@/lib/format";
import { ProductImage } from "@/components/ProductImage";
import { StockBadge } from "@/components/StockBadge";
import { AddToCart } from "@/components/AddToCart";
import { BundleComposition } from "@/components/BundleComposition";

export default function ProductPage({ params }: { params: { id: string } }) {
  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);
  const product = getProductDetail(decodeURIComponent(params.id), mode);
  if (!product) notFound();

  const soldOut = product.stockError !== null || (product.stockDisplay ?? 0) <= 0;
  const capacity = Math.min(
    ...(product.bundleComponents.length
      ? product.bundleComponents.map((c) => Math.floor(c.componentStock / c.multiplierQty))
      : [99]),
  );

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
              {product.isBundle ? "SKU rakitan (BOM ERP)" : product.sizeLabel}
            </span>
          </div>

          <div className="mt-4">
            <StockBadge
              value={product.stockDisplay}
              label={product.stockLabel}
              error={product.stockError}
              aware={product.stockAware}
              mode={mode}
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
              Mode simulasi: {mode === "tobe" ? "to-be" : "baseline"}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink/75">
              {mode === "baseline"
                ? product.isBundle
                  ? "Angka stok di atas adalah kuota manual dari WMS 4.1. Komposisi tidak dikirim, jadi angka tidak akan pernah turun saat komponen terjual — penyebab overselling."
                  : "Stok satuan dibaca langsung dari WMS 4.1 tanpa perubahan."
                : product.isBundle
                  ? "Angka stok dihitung dari komponen pembatas dan ikut turun setiap komponen terjual. Kapasitas nyata saat ini tercantum di tabel komposisi."
                  : "Stok satuan dikurangi penjualan yang tercatat selama sesi simulasi."}
            </p>
            {product.isBundle ? (
              <p className="mt-3 font-mono text-[10px] text-smoke">
                {mode === "baseline"
                  ? `baseline_quota = ${formatNumber(product.stockDisplay ?? 0)} · computed = — (tidak dihitung)`
                  : `baseline_quota = ${formatNumber(product.stockDisplay ?? 0)} · computed = ${formatNumber(capacity)}`}
              </p>
            ) : null}
          </div>

          {product.isBundle ? (
            <div className="mt-6">
              <BundleComposition components={product.bundleComponents} mode={mode} />
            </div>
          ) : null}

          <div className="mt-8 space-y-6">
            <section>
              <h2 className="text-[10px] uppercase tracking-widest2 text-smoke">Deskripsi</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink/80">{product.description}</p>
            </section>

            <section>
              <h2 className="text-[10px] uppercase tracking-widest2 text-smoke">Atribut master data</h2>
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
                  Baseline menampilkan angka per gudang tanpa penjumlahan; to-be memakai
                  total tersedia setelah reservasi.
                </p>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}