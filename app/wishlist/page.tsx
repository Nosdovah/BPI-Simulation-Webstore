import Link from "next/link";

export default function WishlistPage() {
  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Wishlist</p>
        <h1 className="mt-2 font-display text-4xl">Saved Items</h1>
      </div>

      <div className="mt-8 border border-ink/15 bg-bone p-12 text-center">
        <p className="font-display text-3xl">Wishlist belum tersedia</p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-smoke">
          Sesuai batas cakupan blueprint (§1.2), wishlist hanya ditampilkan sebagai
          placeholder agar parity visual terjaga. Tidak ada logika simpan item.
        </p>
        <Link href="/shop" className="btn-primary mt-6">Telusuri katalog</Link>
      </div>
    </div>
  );
}