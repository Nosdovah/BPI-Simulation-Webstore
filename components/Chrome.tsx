import Link from "next/link";

const MARQUEE_TEXT = [
  "GRATIS ONGKIR MIN. PEMBELIAN TERTENTU",
  "BUNDLING HEMAT 10–22%",
  "STOK DIPERBARUI OTOMATIS",
  "PENGIRIMAN KE SELURUH INDONESIA",
];

export function Marquee() {
  const row = [...MARQUEE_TEXT, ...MARQUEE_TEXT];
  return (
    <div className="overflow-hidden border-y border-white/10 py-4">
      <div className="marquee-track">
        {[0, 1].map((dup) => (
          <div key={dup} className="flex shrink-0 items-center">
            {row.map((text, i) => (
              <span
                key={`${dup}-${i}`}
                className="whitespace-nowrap px-6 text-[13px] uppercase tracking-widest2 text-white/70"
              >
                {text} <span className="text-brass">•</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 bg-charcoal text-white">
      <Marquee />
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-14 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-display text-3xl">Octarine.</p>
          <p className="mt-3 max-w-sm text-xs leading-relaxed text-white/60">
            Katalog, harga, dan ketersediaan stok ditampilkan langsung dari sistem
            inventori, sehingga angka yang Anda lihat adalah angka yang siap dikirim.
            Setiap paket bundling dihitung dari ketersediaan komponennya.
          </p>
        </div>

        <div>
          <p className="mb-3 text-[10px] uppercase tracking-widest2 text-white/40">Information</p>
          <ul className="space-y-2 text-xs text-white/70">
            <li><Link href="/shop" className="hover:text-white">Shop</Link></li>
            <li><Link href="/collections" className="hover:text-white">Collections</Link></li>
            <li><Link href="/promo" className="hover:text-white">Promo</Link></li>
            <li><Link href="/blog" className="hover:text-white">Blog</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-[10px] uppercase tracking-widest2 text-white/40">Bantuan</p>
          <ul className="space-y-2 text-xs text-white/70">
            <li><Link href="/lacak-pesanan" className="hover:text-white">Lacak Pesanan</Link></li>
            <li><Link href="/cart" className="hover:text-white">Keranjang</Link></li>
            <li><Link href="/wishlist" className="hover:text-white">Wishlist</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-[10px] uppercase tracking-widest2 text-white/35">
        © 2026 Octarine. Seluruh hak dilindungi.
      </div>
    </footer>
  );
}