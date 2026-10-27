# Octarine Sandbox — Webstore Simulasi BPI (DMAIC)

Replika webstore untuk **simulasi** proyek peningkatan proses `BPI DMAIC` di PT Octarine
(Octarine.co.id). Dibangun sebagai *bootleg sandbox*: tampilan meniru toko asli, tetapi
seluruh produk, harga, stok, pesanan, dan pembayaran adalah **data sintetis**.

> **Bukan toko resmi.** Tidak ada afiliasi dengan Octarine. Tidak ada transaksi nyata.
> Jangan pakai data pribadi asli.

---

## 1. Kenapa repo ini ada

Paper DMAIC punya dua temuan utama yang sulit dibuktikan kalau hanya berupa tabel:

1. **Overselling varian bundling** — webstore menampilkan stok bundling dari *kuota manual*
   WMS 4.1 (`baseline_quota`), bukan hasil hitung komponen. Contoh flagship:
   `SANCTUM-NOCTIS-20ML-A1` tampil **10.932** padahal stok material pembatasnya
   `M2292 = 10.932` dan `M2291 = 11.927`; ketika `M2292` terjual 500 unit, angka di webstore
   **tidak berubah** → potensi oversell 500 unit per siklus.
2. **Order fulfillment status tidak sinkron** — order masuk dengan payload kosong, status
   mentok di `on_process`/`SENT`, dan penyelesaiannya bergantung pada klik manual staf.

Sandbox ini membuat kedua cacat itu **bisa diklik, difoto, dan diukur** — lalu dibandingkan
dengan kondisi *to-be* yang sudah diperbaiki pada kode yang sama.

## 2. Cara membuktikan dalam 60 detik

1. Buka `/product/SANCTUM-NOCTIS-20ML-A1` → catat stok, aktifkan **BASELINE**.
2. Buka `/admin/simulasi` → "Jual komponen" `M2292` sebanyak `500`.
3. Lihat SKU yang sama di **BASELINE**: stok tetap `10.932`.
4. Ganti ke **TO-BE**: stok menjadi `10.432`, tabel komposisi menandai `M2292` sebagai
   komponen pembatas (`←`).
5. Checkout satu bundling di **TO-BE** → order langsung punya 10 tahap status dan bergerak
   otomatis setiap 7 detik sampai `COMPLETED` (actor: `SYSTEM`).
6. Checkout di **BASELINE** → order berhenti di `SENT` / `on_process` dan hanya selesai
   kalau tombol "Simulasikan klik manual staff" ditekan.

## 3. Stack

- Next.js 14.2.35 (App Router, React 18, TypeScript strict)
- Tailwind CSS 3.4, tanpa library UI eksternal
- Katalog **generator deterministik** (`lib/catalog.ts`) — tidak ada file data besar:
  176 single SKU + 3.520 bundle SKU = **3.696 SKU**, seed tetap `20260918`
- Order disimpan sebagai **token bertanda tangan HMAC** di URL + store in-memory
  → jalan tanpa database, tanpa credential
- API routes bertindak sebagai `osr-core` versi ringkas (`/api/catalog/*`, `/api/orders`)

## 4. Struktur

```
app/
  page.tsx                 homepage (hero, kategori, grid)
  shop/                    katalog + filter + sort + pagination
  product/[id]/            detail SKU (bundle composition, stock resolution)
  collections/[slug]/      4 koleksi
  cart/  checkout/         keranjang & checkout (payment mock)
  order/[ref]/             ringkasan order + timeline live
  order/[ref]/track/       halaman pelacakan
  lacak-pesanan/           lookup nomor order
  promo/  blog/  wishlist/ parity visual (statis)
  admin/simulasi/          panel bukti: phantom stock, FMEA, telemetri
  api/                     catalog, orders, mode, sim, telemetry
components/                header, kartu produk, timeline, kontrol simulasi
lib/
  catalog.ts               3.696 SKU deterministik
  stock.ts                 resolveStockDisplay() baseline vs to-be
  orders.ts                ref, token HMAC, state machine 10 status
  core.ts                  "osr-core": list/detail/stock/checkout
  state.ts                 cookie mode, penjualan komponen, telemetri
```

## 5. Menjalankan lokal

```bash
npm install
npm run build && npm run start   # http://localhost:3000
# atau
npm run dev
```

Tanpa `.env` pun jalan penuh. Variabel opsional ada di `.env.example`.

## 6. Variabel lingkungan

- `OSR_MODE` — `baseline` | `tobe` (default bila cookie belum diset)
- `OSR_ORDER_SECRET` — kunci HMAC token order; **wajib diganti** di deployment publik
- `OSR_CORE_URL` — arahkan ke core OSR penuh (docker-compose) bila nanti dipakai
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — **opsional**, untuk persistensi order
  lintas instance/perangkat (versi ini belum memakainya)

## 7. Batas cakupan (sesuai blueprint §1.2)

Tidak diimplementasikan: wishlist logic, akun/login, payment gateway nyata, engine promo,
integrasi kurir nyata, dashboard WMS. Semua halaman yang menyebut fitur tersebut hanya
placeholder paritas visual — ditandai eksplisit di UI dan footer.

## 8. Etika & keamanan

- Tanpa PII nyata. Form checkout memakai data contoh; jangan isi data asli.
- Tanpa egress internet, tanpa scraping saat runtime.
- Branding "Octarine Sandbox" + banner "SIMULASI — BUKAN TOKO RESMI" di setiap halaman.
- Semua order bisa dihapus dengan menghapus cookie/localStorage; state server in-memory.

## 9. Deploy

Repo ini siap diimpor ke Vercel (framework terdeteksi otomatis sebagai Next.js).
Tidak butuh build command khusus. Untuk domain demo, set `OSR_MODE=tobe` dan
`OSR_ORDER_SECRET` acak.

---

Dibuat untuk keperluan akademik (tugas BPI & Inovasi, Bisnis Digital).