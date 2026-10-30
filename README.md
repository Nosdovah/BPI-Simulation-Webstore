# Octarine Webstore

Webstore Octarine: katalog, pemesanan, dan pelacakan pesanan. Seluruh produk, harga,
stok, dan komposisi paket dibaca dari master data ERP (MOAI SCM-ERP) — tidak ada
katalog yang dipaku di kode.

> Repo ini adalah replika untuk keperluan proyek peningkatan proses (BPI/DMAIC) di
> PT Octarine, bukan toko resmi. Tidak ada transaksi nyata. Dijalankan dengan
> `robots: noindex`.

---

## 1. Yang ditampilkan

Satu alur proses saja, tanpa saklar mode:

1. **Katalog & stok** — SKU satuan memakai stok on-hand; SKU paket dihitung dari
   komponen pembatas `MIN(FLOOR(stok / qty))` sehingga angka yang tampil selalu bisa
   dikirim.
2. **Validasi stok di core** — checkout memeriksa ulang ketersediaan; kalau stok
   berubah, order ditolak dengan `STOCK_CHANGED` (atau `COMPOSITION_MISSING` bila BOM
   tidak lengkap).
3. **Order & status** — order masuk sebagai `PAID` dengan `wms_order_id`, lalu bergerak
   melalui 10 tahap status baku sampai `COMPLETED`. Tidak ada status di luar daftar.
4. **Pelacakan** — halaman `/order/[ref]` dan `/order/[ref]/track` menyegarkan status
   otomatis setiap 4 detik; nomor resi muncul mulai tahap `HANDOVER_TO_COURIER`.
5. **Webhook masuk** — `POST /api/webhooks/wms` menerima `stock.updated` dan
   `order.status_changed`, dengan dedupe idempotency dan (opsional) HMAC.

## 2. Stack

- Next.js 14 (App Router, React Server Components) + TypeScript
- Tailwind CSS
- Tanpa database wajib: order disimpan in-memory + token bertanda tangan (HMAC-SHA256)
  di URL, jadi order tetap terbaca setelah refresh atau pindah instance.

## 3. Menjalankan

```bash
npm install
cp .env.example .env.local   # isi OSR_ORDER_SECRET
npm run erp:sync             # tarik master data ERP → .data/erp/catalog.snapshot.json
npm run dev                  # http://localhost:3000
```

Build produksi:

```bash
npm run build && npm run start
```

## 4. Sumber data ERP

```
ERP REST API ──npm run erp:sync──► .data/erp/catalog.snapshot.json ──mapper──► Product[]
```

- `OSR_CATALOG_SOURCE=snapshot` (default) membaca snapshot ber-checksum.
- `OSR_CATALOG_SOURCE=live` menarik langsung dari ERP saat proses start.
- Kalau snapshot tidak ada, aplikasi gagal terang-terangan dengan pesan perbaikan —
  tidak diam-diam memakai data contoh.

Kontrak integrasi aktif ada di `docs/KONTRAK_API_ERP.md`; versi acuan resmi dan
panduan koneksi lama diarsipkan di `docs/arsip/`.

## 5. Struktur

```
app/
  page.tsx                 beranda (hero, koleksi, katalog unggulan)
  shop/                    katalog + filter + pencarian
  collections/             koleksi dari item_type ERP
  product/[id]/            detail produk + komposisi paket
  cart/ checkout/          keranjang dan checkout
  order/[ref]/             ringkasan pesanan + timeline status
  order/[ref]/track/       halaman pelacakan
  lacak-pesanan/           form pencarian nomor pesanan
  api/catalog/             read model katalog & stok
  api/orders/              pembuatan order + status
  api/webhooks/wms/        penerima event dari ERP/WMS
components/                header, kartu produk, timeline, form
lib/
  catalog.ts               muat snapshot + indeks
  core.ts                  read model (kartu, detail, cek stok)
  stock.ts                 aturan stok satuan vs paket
  orders.ts                order, token, state machine status
  webhooks.ts              autentikasi, dedupe, apply event
scripts/
  erp-sync.mjs             tarik data ERP → snapshot
  verify.mjs               smoke test
```

## 6. Catatan keamanan

- `OSR_ORDER_SECRET` wajib diganti di deployment; token order ditandatangani HMAC.
- Webhook butuh bearer token (`OSR_WEBHOOK_TOKEN`) dan opsional
  `X-OSR-Signature: sha256=<hmac>`; tanpa secret, signature tidak diwajibkan.
- `robots: noindex, nofollow` aktif agar tidak terindeks mesin pencari.

## 7. Dokumentasi

| Dokumen | Isi |
|---|---|
| `docs/DOKUMEN_RBAC.md` · [PDF](docs/DOKUMEN_RBAC.pdf) | Skema RBAC storefront & panel admin (v1.2) — peran, 15 izin, sesi token, audit log |
| `docs/SLUG_WEBSTORE.md` · [PDF](docs/SLUG_WEBSTORE.pdf) | Spesifikasi slug kanonik tiap halaman webstore & admin (v1.1) |
| `docs/KONTRAK_API_ERP.md` | Kontrak API ERP aktif yang dipakai `erp:sync` |
| `docs/INTEGRASI_WEBHOOK_ERP.md` | Alur webhook event ERP/WMS ke repo ini |
| `docs/arsip/` | Versi lama kontrak, panduan koneksi, dan acuan resmi |

Dokumen `.md` adalah sumber; `.pdf` adalah hasil render untuk dibagikan.