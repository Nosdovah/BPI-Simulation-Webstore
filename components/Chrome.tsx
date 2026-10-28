import Link from "next/link";

const MARQUEE_TEXT = [
  "MASTER DATA ERP // LIVE KATALOG",
  "HARGA & STOK DARI SISTEM ERP",
  "SKU RAKITAN DIHITUNG DARI BOM",
  "SINKRONISASI ORDER KE WMS",
  "REPLIKA SIMULASI // BUKAN TOKO RESMI",
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
            Octarine Sandbox adalah replika webstore untuk simulasi proyek
            peningkatan proses (DMAIC). Katalog, harga, dan stok dibaca dari master
            data ERP melalui API; pesanan yang dibuat di sini tidak pernah dikirim
            ke sistem produksi. Tidak ada transaksi nyata dan tidak ada afiliasi
            dengan Octarine resmi.
          </p>
          <p className="mt-4 text-[10px] uppercase tracking-widest2 text-white/40">
            Simulasi — bukan toko resmi
          </p>
        </div>

        <div>
          <p className="mb-3 text-[10px] uppercase tracking-widest2 text-white/40">Information</p>
          <ul className="space-y-2 text-xs text-white/70">
            <li><Link href="/shop" className="hover:text-white">Shop</Link></li>
            <li><Link href="/lacak-pesanan" className="hover:text-white">Lacak Pesanan</Link></li>
            <li><Link href="/promo" className="hover:text-white">Promo</Link></li>
            <li><Link href="/blog" className="hover:text-white">Blog</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-[10px] uppercase tracking-widest2 text-white/40">Simulasi</p>
          <ul className="space-y-2 text-xs text-white/70">
            <li><Link href="/admin/simulasi" className="hover:text-white">Panel Simulasi</Link></li>
            <li><Link href="/admin/simulasi#fmea" className="hover:text-white">FMEA F1–F7</Link></li>
            <li><Link href="/admin/simulasi#metrik" className="hover:text-white">Metrik DMAIC</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-[10px] uppercase tracking-widest2 text-white/35">
        © 2026 Octarine Sandbox · data master dari ERP · mode simulasi
      </div>
    </footer>
  );
}