import Link from "next/link";

const PROMOS = [
  {
    title: "Bundling 2 Botol 20ml",
    copy: "Pilih dua varian 20ml, harga otomatis lebih hemat 10–22%.",
    cta: "/shop?sort=price-asc",
    label: "Lihat bundling",
  },
  {
    title: "Voucher 10K",
    copy: "Diskon Rp 10.000 untuk transaksi pertama Anda.",
    cta: "/shop",
    label: "Belanja sekarang",
  },
  {
    title: "Launching 20ml colors",
    copy: "Seri warna baru 20ml — stok terbatas, dihitung dari komponen.",
    cta: "/collections",
    label: "Buka koleksi",
  },
  {
    title: "Free 20ml Numayr",
    copy: "Bonus 20ml untuk pembelian extrait 50ml selama periode promo.",
    cta: "/collections",
    label: "Lihat kolaborasi",
  },
];

export default function PromoPage() {
  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Promo</p>
        <h1 className="mt-2 font-display text-4xl">Penawaran Berjalan</h1>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-smoke">
          Penawaran yang sedang berjalan. Harga yang tampil di katalog adalah harga
          akhir setelah potongan promo.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {PROMOS.map((p) => (
          <article key={p.title} className="border border-ink/15 p-6">
            <h2 className="font-display text-2xl">{p.title}</h2>
            <p className="mt-2 text-xs leading-relaxed text-smoke">{p.copy}</p>
            <Link href={p.cta} className="mt-5 inline-block text-[10px] uppercase tracking-widest2 underline underline-offset-4">
              {p.label}
            </Link>
          </article>
        ))}
      </div>

      <div className="mt-10 border border-ink/15 bg-bone p-5 text-[11px] leading-relaxed text-ink/75">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Ketentuan promo</p>
        <p className="mt-2">
          Potongan harga paket bundling (10–22% dari jumlah harga komponen) berlaku
          otomatis di keranjang. Satu kode voucher hanya dapat dipakai satu kali per
          akun selama periode promo berlangsung.
        </p>
      </div>
    </div>
  );
}