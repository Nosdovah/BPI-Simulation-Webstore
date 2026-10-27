import Link from "next/link";

const POSTS = [
  {
    title: "Cara memilih parfum untuk cuaca tropis",
    excerpt:
      "Konsentrasi, proyeksi, dan ketahanan aroma di suhu 30°C — apa yang berubah dibanding iklim dingin.",
    date: "12 Oktober 2026",
  },
  {
    title: "Eau de Parfum vs Extrait: mana yang cocok?",
    excerpt:
      "Perbedaan konsentrasi minyak, durasi, dan kapan sebaiknya memilih extrait.",
    date: "28 September 2026",
  },
  {
    title: "Menyimpan parfum agar tidak berubah",
    excerpt:
      "Suhu, cahaya, dan oksigen adalah tiga musuh utama. Panduan singkat penyimpanan.",
    date: "9 September 2026",
  },
];

export default function BlogPage() {
  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Blog</p>
        <h1 className="mt-2 font-display text-4xl">Journal</h1>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-smoke">
          Halaman statis untuk parity visual. Artikel di bawah adalah contoh, bukan
          konten resmi.
        </p>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {POSTS.map((post) => (
          <article key={post.title} className="group">
            <div className="aspect-[4/3] w-full bg-mist" />
            <p className="mt-3 text-[10px] uppercase tracking-widest2 text-smoke">{post.date}</p>
            <h2 className="mt-1 text-sm leading-snug">{post.title}</h2>
            <p className="mt-2 text-xs leading-relaxed text-smoke">{post.excerpt}</p>
            <span className="mt-3 inline-block text-[10px] uppercase tracking-widest2 underline underline-offset-4">
              Read article
            </span>
          </article>
        ))}
      </div>

      <div className="mt-10">
        <Link href="/shop" className="btn-ghost">Kembali ke katalog</Link>
      </div>
    </div>
  );
}