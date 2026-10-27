import Link from "next/link";
import type { Mode, ProductCard as ProductCardType } from "@/lib/types";
import { formatIdr } from "@/lib/format";
import { ProductImage } from "./ProductImage";
import { StockBadge } from "./StockBadge";

export function ProductCard({
  product,
  mode,
}: {
  product: ProductCardType;
  mode: Mode;
}) {
  return (
    <Link href={`/product/${product.sku}`} className="group block">
      <div className="relative">
        <ProductImage
          imageKey={product.imageKey}
          name={product.name}
          isBundle={product.isBundle}
          className="aspect-[4/5] w-full transition-transform duration-500 group-hover:scale-[1.01]"
        />
      </div>
      <div className="mt-3 space-y-1">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">
          {product.gender} · {product.sizeLabel}
        </p>
        <h3 className="line-clamp-2 text-[13px] leading-snug text-ink">
          {product.name}
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium">{formatIdr(product.priceIdr)}</span>
          {product.compareAtIdr ? (
            <span className="text-[11px] text-smoke line-through">
              {formatIdr(product.compareAtIdr)}
            </span>
          ) : null}
        </div>
        <div className="pt-1">
          <StockBadge
            value={product.stockDisplay}
            label={product.stockLabel}
            error={product.stockError}
            aware={product.stockAware}
            mode={mode}
          />
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({
  products,
  mode,
}: {
  products: ProductCardType[];
  mode: Mode;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.sku} product={p} mode={mode} />
      ))}
    </div>
  );
}