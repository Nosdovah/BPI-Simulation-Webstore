# Audit Integrasi Storefront ↔ ERP — Octarine / BPI
### Bukti live: cart server-side, core stock handler, dan status order

**Tanggal:** 31 Oktober 2026 · **Versi:** 1.0 · **Sifat:** read-only, kecuali 3 write probe yang di-disclose di §8
**Objek audit:** `bpi-simulation-webstore-eosin.vercel.app` (storefront) ↔ `web-production-e60b55.up.railway.app` (ERP replica Perpack)
**Akun uji:** storefront `ditoibrahim47@gmail.com` (role CUSTOMER, uid `b614a7be-8e61-4e2d-938a-4cea222507f1`) · ERP `admin`

> ## ⚠️ DOKUMEN INI SUDAH BASI — QA pass ke-3, 31 Okt 2026 10:16 UTC
>
> Probe ulang pada hari yang sama membalik beberapa temuan di bawah. Sumber kebenaran
> sekarang: tab **`QA ERP - Storefront / Vice Versa`** di sheet `BPI-Simulation - QA`
> (40 kasus, 31 Pass / 8 Failed / 1 Not Run).
>
> | Temuan di dokumen ini | Keadaan setelah re-probe |
> |---|---|
> | Stok −2 untuk order 1 unit (dobel potong) | ~~SALAH~~ → `9.974 → 9.973 (−1)`, `stockEvents[{skipped:true, reason:"erp_already_deducted"}]`. Build `57462cb` sudah live. |
> | Produksi menjalankan build yang salah | ~~SALAH~~ → alias produksi menyajikan `57462cb` (`GET /api/cart/reap` → 200 `osr-cart-reaper`). |
> | Keranjang tamu ditolak 401 | ~~SALAH~~ → tamu boleh mengisi (`guest:true`, cookie HMAC) **dan** isinya di-merge saat daftar (`mergedItems:1`). |
> | Order hilang setelah cold start | ~~SEBAGIAN~~ → `?k=<token>` bertanda tangan berfungsi; tanpa token masih 200 selama lambda hangat (recall memori diperiksa sebelum validasi token). |
> | Webhook tanpa signature | **DIPERKUAT** → `OSR_WEBHOOK_HMAC_SECRET` tidak diset di produksi sehingga `verifySignature()` meloloskan semua event. |
>
> Yang **masih berlaku** dari dokumen ini: katalog beku (snapshot 29 Okt), TO-BE belum
> dipakai storefront, push ERP kosong, ongkir/kurir NULL, 15 SKU ganda, order terbuka menua.

---

## 0. Verdict

**Terintegrasi — tetapi produksi menjalankan build yang salah, dan pemotongan stok terjadi dua kali.**

Satu kalimat per jalur:

- **Jalur A — katalog:** *tidak live.* Storefront membaca **snapshot beku** per 29 Okt 2026 14:54:52Z, bukan API ERP.
- **Jalur B — order storefront → ERP:** **hidup dan terbukti.** Order `ORD-WEBSTORE-PROD-261031-1001-VFYU` masuk ke ERP sebagai `id 5826585`, `channel WEBSTORE`, `qty 1`, `amount 20000`.
- **Jalur C — status ERP → storefront:** **hidup sebagai pull on-demand** (dibuktikan `PAID → PROCESS → PACKING → SENT` mengikuti ERP). **Push dari ERP mati** — `ERP_PUSH_WEBHOOK_URL` tidak diset.
- **Cart server-side Supabase:** **terbukti di empat lapis**, termasuk atomisitas 5 tulis paralel.

Tapi ada satu temuan yang mengubah kesimpulan stok: untuk order **1 unit**, stok `M2291` di ERP turun **9975 → 9973 (−2)**. ERP memotong 1, storefront mengirim `stock.updated` 1 lagi. Penyebabnya bukan kode yang belum ditulis — kodenya **sudah ada dan sudah di-commit**, tapi **build-nya gagal**, sehingga produksi masih menyajikan commit sebelumnya.

---

## 1. Status per jalur

| Jalur | Arah | Mekanisme riil | Status | Bukti |
|---|---|---|---|---|
| A — Katalog & stok baca | ERP → storefront | snapshot file, `OSR_CATALOG_SOURCE` tidak diset (default `snapshot`) | [!] beku 2 hari | Probe #8, #9 |
| B — Order & stok tulis | storefront → ERP | `POST /api/webhooks/purchase-order` + `POST /api/webhooks/wms` | YA hidup | Probe #10–#14 |
| C — Status balik | ERP → storefront | pull `POST /v1/orders/page` saat halaman order dibuka | YA hidup (on-demand) | Probe #17, #20 |
| C-push | ERP → storefront | `ERP_PUSH_WEBHOOK_URL` | TIDAK mati | Probe #18 |
| D — Cart & akun | storefront → Supabase | RPC Postgres `osr_cart_*` | YA terbukti 4 lapis | Probe #4–#7 |

---

## 2. Diagram alur (kondisi riil, bukan rancangan)

```
              PELANGGAN
                  │
                  ▼
      ┌────────────────────────┐          ┌──────────────────────────┐
      │ STOREFRONT (Vercel)    │          │ SUPABASE (Postgres)      │
      │ build: 37a3193         │◄────────►│ osr_user                 │
      │ (bukan HEAD)           │   RPC    │ osr_cart / _item         │
      └───────────┬────────────┘          └──────────────────────────┘
                  │
            ┌─────┴───────────────┐
            │                     │
            ▼ A. BACA KATALOG     ▼ B. TULIS ORDER + STOK
            │                       POST /api/webhooks/purchase-order
            ▼                       POST /api/webhooks/wms (stock.updated)
    ┌──────────────────────┐                      │
    │ snapshot.json        │
    │ fetched 2026-10-29   │                      ▼
    │ 3.727 produk         │         ┌──────────────────────────┐
    └──────────────────────┘         │ ERP REPLICA RAILWAY      │
    X  TIDAK live — bukan API         │ 21 endpoint /openapi     │
                                     │ order 5826585            │
                                     └────────────┬─────────────┘
                                                  │
                                           C. STATUS BALIK
                                      ┌───────────┴───────────┐
                                      ▼                       ▼
                              pull /v1/orders/page            push webhook
                              (saat order dibuka)             X  MATI
                                      │                       ERP_PUSH_WEBHOOK
                                      │                       _URL tidak diset
                                      └──►  status di UI
```

Sisi kanan bawah adalah satu-satunya sisi yang mati. Semua jalur lain hidup hari ini.

---

## 3. Bukti — 20 probe

Semua angka di bawah diambil langsung dari respons server, bukan dari dokumentasi.

| # | Uji | Hasil | Kesimpulan |
|---|---|---|---|
| 1 | `GET /` storefront | `200`, `server: Vercel`, `x-vercel-cache: MISS` | Hidup |
| 2 | `GET /healthz` ERP | `200 {"ok":true,"service":"perpack-wms-replica"}` | Hidup |
| 3 | `POST /api/auth/login` storefront | `200`, uid `b614a7be-8e61-4e2d-938a-4cea222507f1`, role `CUSTOMER` | Sesi sah |
| 4 | `GET /api/cart` | `backend:"supabase"`, `lines:[]` | Lapis 1 lulus |
| 5 | PostgREST `osr_cart` | 1 baris, `owner_id = b614a7be…` **= uid sesi** | Lapis 2 lulus |
| 6 | Login ulang, cookie jar baru, `GET /api/cart` | `count 5`, `M2291 ×5` | Lapis 3 lulus |
| 7 | 5× POST paralel (`xargs -P5`) SKU sama | `count 5` — bukan 1..4 | Lapis 4 lulus (atomik) |
| 8 | `GET /api/catalog/stock?skus=M2291` | `stockDisplay 9976` | Angka dari snapshot |
| 9 | ERP `/api/webhooks/catalog` (15 halaman) | `M2291 = 9975` | **Drift +1** vs storefront |
| 10 | `POST /api/orders` (cart 1× M2291) | `200`, `synced:true`, `erp_id 5826585`, `erp_status paid`, `degraded:false` | Jalur B lulus |
| 11 | ERP `/v1/orders/page` cari ref | `id 5826585`, `qty 1`, `amount 20000`, `channel WEBSTORE`, `customer AUDIT-PROBE-HERMES`, `order_at 06:01:21Z` | Order benar-benar masuk |
| 12 | ERP catalog setelah checkout | `M2291 = 9973` | **−2 untuk 1 unit** |
| 13 | ERP event `#21` (`purchase-order.created`) | `stock.deducted: {"M2291": 1}` | ERP memotong 1 |
| 14 | ERP event `#22` (`stock.updated` dari storefront) | `sisa_stok_total: 9973` | Storefront memotong 1 lagi |
| 15 | POST ulang `purchase-order` ref sama | `applied:false`, `note:"…sudah ada (idempotent)"`, `order_id 5826585`, count tetap **1** | Idempotensi order lulus |
| 16 | `POST /api/webhooks/wms` `status=delivered` | `422 invalid_status` + `allowed[]` 11 nilai | Guard enum lulus |
| 17 | `POST /api/webhooks/wms` `status=process` | `200 applied:true` | Status maju |
| 18 | `GET /api/push-outbox` | `{"data": []}`; setiap respons memuat `push:{pushed:false,status:"skipped",note:"ERP_PUSH_WEBHOOK_URL tidak diset"}` | Push mati |
| 19 | `GET /api/orders/{ref}?k=<token>` | `status PROCESS`, `sync.found:true`, `last_sync_source:"poll"` | Jalur C lulus |
| 20 | Ulang setelah status ERP = `sent` | `status SENT`, `erp.raw_status "sent"`, `last_sync_source "poll"` | Jalur C mengikuti ERP |

Dua probe tambahan (kontrol negatif) ada di §6 F-06.

---

## 4. Cart server-side Supabase — empat lapis, semua lulus

Klaim yang diuji: *"keranjang sudah pindah ke server, bukan lagi di browser."* Klaim ini biasanya gagal di lapis 2, karena route bisa saja menjawab `backend:"supabase"` sambil menulis ke memori.

- **Lapis 1 — self-declaration.** `GET /api/cart` → `{"backend":"supabase","guest":false}`. Perlu, tidak cukup.
- **Lapis 2 — baris nyata dengan pemilik = uid sesi.** PostgREST langsung: `osr_cart` id `3bfe2c22-7662-4198-9e3d-c28a873dc894`, `owner_id b614a7be-8e61-4e2d-938a-4cea222507f1`. **Sama persis dengan `uid` dari respons login** — bukan nilai dari cookie, bukan dari body. Ini pembeda antara "server-side" dan "penyimpanan server atas kunci milik klien".
- **Lapis 3 — perangkat lain.** Cookie jar baru, login ulang, `GET /api/cart` → `count 5`. Data milik akun, bukan milik proses.
- **Lapis 4 — atomisitas.** 5 permintaan paralel sungguhan (`seq 5 | xargs -P5`) untuk SKU yang sama → `qty 5`. Kalau hasilnya 1–4, berarti read-modify-write di aplikasi; hasil 5 membuktikan kenaikan terjadi di dalam satu statement SQL. Mekanismenya `sbRpc("osr_cart_add", …)` di `lib/cart-server.ts:204` — RPC Postgres, bukan tiga round-trip.

Yang juga benar dan penting: pemilik keranjang **tidak pernah** datang dari klien. `resolveCartOwner()` (`lib/cart-owner.ts:113`) menurunkan owner dari sesi, atau `guest:<uuid>` dari cookie bertanda tangan HMAC. Checkout membaca isi keranjang **dari server** (`app/api/orders/route.ts:63`), body hanya dipakai sebagai cadangan. Harga selalu dari katalog, `qty` dijepit 1..99.

---

## 5. Core stock handler — peta fungsi

Ini yang diminta dicek: "fungsi core stock handler". Setiap baris menyebut lokasi persisnya.

| Fungsi | Lokasi | Peran |
|---|---|---|
| `componentStocks()` | `lib/core.ts:19` | Peta stok komponen mentah: `stockOnHand − terjual` |
| `resolveStockDisplay()` | `lib/stock.ts:38` | **Satu-satunya** tempat logika tampilan stok. Mode `as-is` = angka ERP apa adanya; `to-be` = `MIN(⌊stok/multiplier⌋)` |
| `resolveBundleStock()` | `lib/stock.ts:101` | Versi murni perhitungan kapasitas bundle |
| `checkStock()` | `lib/core.ts:179` | Validasi stok di server saat add-to-cart **dan** saat checkout |
| `GET /api/catalog/stock` | `app/api/catalog/stock/route.ts:9` | Endpoint baca stok (memakai `?skus=`, jamak) |
| `pushStockUpdated()` | `lib/erp/order.mjs:330` | Kirim `stock.updated` ke ERP |
| Pemilik pengurangan stok | `app/api/orders/route.ts:220` | Aturan `OSR_ERP_STOCK_OWNER` (`auto`/`erp`/`storefront`) |
| `loadSnapshotSync()` | `lib/erp/client.ts:18` | Sumber angka: snapshot, bukan panggilan live |

**Yang benar:** stok divalidasi ulang di server pada checkout (`app/api/orders/route.ts:85`), bukan hanya di UI — jadi keranjang yang menua tidak bisa lolos. Kegagalan validasi mengembalikan `409 STOCK_CHANGED` atau `409 COMPOSITION_MISSING`, bukan error generik.

**Yang salah:** angka yang divalidasi berasal dari **snapshot**, bukan dari ERP saat itu juga. Storefront menampilkan `9976` untuk `M2291` sementara ERP memegang `9975`. Arahnya menjual angka yang tidak lagi benar — dan ERP tidak punya mekanisme menolak (lihat F-05).

**Dan yang paling mahal:** keputusan *siapa yang memotong stok* bergantung pada satu field di respons ERP. Field itu tidak terbaca, sehingga dua pihak memotong. Lihat F-02.

---

## 6. Status order — peta fungsi + temuan

| Fungsi | Lokasi | Peran |
|---|---|---|
| `nextOrderRef()` | `lib/orders.ts:98` | Format `ORD-WEBSTORE-PROD-YYMMDD-SSSS-RAND5` |
| `pushOrder()` | `lib/erp/order.mjs:166` | Kirim order ke ERP, baca `stock_deducted` |
| `applyErpPush()` | `lib/orders.ts:268` | Catat `erpId`, `pushedAt`, status awal |
| `applyErpStatus()` | `lib/orders.ts:218` | Tahan status mundur (kecuali terminal) |
| `applyErpLookup()` | `lib/orders.ts:295` | Rekonsiliasi hasil poll ERP |
| `deriveStatus()` | `lib/orders.ts:146` | Timeline 8 tahap, **sumber tunggal = status ERP** |
| `fetchErpOrder()` | `lib/erp/order.mjs:234` | `POST /v1/orders/page` + filter `reference_no` persis |
| `GET /api/orders/[ref]` | `app/api/orders/[ref]/route.ts:53` | Butuh `?k=<token>` atau order di memori proses |
| Receiver webhook | `app/api/webhooks/wms/route.ts:66` | Verifikasi `x-osr-signature` atas raw body |

Desainnya benar: storefront **tidak mengarang kemajuan**. Tidak ada "kalau sudah 2 hari berarti dikirim". Nomor resi juga tidak dikarang — hanya `awb` dari ERP yang tampil.

### F-01 CRITICAL — Produksi menjalankan build yang salah (deploy gap)

Vercel API, alias produksi:

```
production alias  → dpl_78ba21Z9  state READY  sha 37a3193  "fix(checkout): nama produk panjang…"
deployment terakhir → dpl_F3CqM8pZ  state ERROR  sha cfa6152  "fix(stok): cegah pemotongan stok dua kali…"
HEAD lokal        → 19f183c  (tidak pernah di-deploy)
26f44bf           → tidak pernah di-deploy
```

Build `cfa6152` gagal, dan inilah pesan aslinya:

```
./lib/erp/order.mjs
Error: x Expected ',', got 'as'
  194 | Object.entries(deductedRaw as Record<string, unknown>).map(...
      |                             ^^
> Build failed because of webpack errors
```

Type-assert TypeScript di dalam file `.mjs` — persis yang diperbaiki commit `26f44bf`, yang **belum pernah di-deploy**. Jadi: perbaikan pemotongan-stok-ganda sudah ditulis, build-nya gagal, commit perbaikannya tidak pernah naik. Produksi masih `37a3193`.

**Ini yang mengubah rencana:** setiap klaim "sudah diperbaiki" untuk stok dan keranjang tamu harus dianggap **belum live** sampai `19f183c` (atau minimal `26f44bf`) benar-benar READY di alias produksi.

### F-02 CRITICAL — Stok terpotong dua kali, terukur live

Satu order, satu unit, dua pemotongan:

```
M2291 sebelum checkout      : 9975
POST /api/orders (1 unit)   : 200, synced true, erp_id 5826585
ERP event #21 purchase-order: stock.deducted {"M2291": 1}   ← potong #1
ERP event #22 stock.updated : sisa_stok_total 9973           ← potong #2
M2291 sesudah checkout      : 9973                          (−2 untuk 1 unit)
```

Rantainya di kode: `lib/erp/order.mjs:190` membaca

```js
const deductedRaw = data.stock_deducted?.deducted;
```

sedangkan ERP mencatat blok pemotongan di `data.stock.deducted` (bentuknya terlihat di effect event #21: `"stock": {"resolved": […], "deducted": {"M2291": 1}}`). Karena `stockDeducted` menjadi `null`, `app/api/orders/route.ts:242` menyimpulkan "ERP tidak memotong" dan mengirim `stock.updated` sendiri.

Jujur soal tingkat keyakinan: pembacaan field-path di atas **belum terverifikasi pada build yang benar**, karena build yang berisi guard itu tidak pernah jalan (F-01). Yang terverifikasi adalah gejalanya (−2) dan mekanisme yang menyebabkannya. **Urutan kerjanya: deploy dulu, lalu verifikasi field-nya, jangan sebaliknya.**

### F-03 HIGH — Guard idempotensi stok tidak ada

POST ulang `purchase-order` dengan `reference_no` sama menjawab:

```json
{"applied": false, "note": "reference_no … sudah ada (idempotent)", "order_id": 5826585, "status": "paid"}
```

Order tidak terduplikasi (bagus), tetapi **respons itu tidak memuat blok stok sama sekali**. Artinya kalau pelanggan menekan checkout dua kali setelah F-01 diperbaiki, guard akan kembali membaca `null` dan mengirim `stock.updated` lagi. Yang dibutuhkan bukan perbaikan field, tapi **ledger idempotensi per baris stok** (`order_ref + sku → deducted`), dan itu belum ada.

### F-04 HIGH — Katalog bukan live, dan itu tidak dinyatakan ke pengguna

Snapshot: `fetched_at 2026-10-29T14:54:52Z`, `checksum 094a46ae…`, 3.727 produk. Hari audit: 31 Okt. Selisih nilai terukur pada satu SKU: storefront `9976` vs ERP `9975`. Tidak ada `fetched_at` yang ditampilkan di UI.

Ini bukan "salah", ini **window**: storefront menjual angka yang sudah dijanjikan. Yang paling murah: jalankan `npm run erp:sync` sebelum demo dan tampilkan `fetched_at`. Yang benar: panggil ERP live hanya untuk endpoint stok, cache 30 detik.

### F-05 HIGH — Jalur C-push mati, dan status balik butuh token yang mudah hilang

- `ERP_PUSH_WEBHOOK_URL` tidak diset → setiap event menjawab `push:{pushed:false,status:"skipped"}`. `/api/push-outbox` kosong. Receiver di storefront sehat, tapi **receiver sehat bukan integrasi hidup**.
- Konsekuensinya status hanya bergerak kalau halaman order dibuka (`GET /api/orders/[ref]`), dan route itu menerima order dari `recallOrder()` (Map di memori proses) **atau** `?k=<token>`. Setelah cold start serverless, order hilang dari UI kecuali pelanggan masih memegang URL bertoken. Riwayat pesanan tidak bisa dibuka ulang dari akun.

Kalau header signature dipakai nanti: ERP mengirim `X-Perpack-Signature`, storefront memverifikasi `x-osr-signature` (`app/api/webhooks/wms/route.ts:85`). Setel URL push tanpa menyamakan nama header = setiap push gagal `BAD_SIGNATURE`, dan gejalanya akan terbaca "push rusak".

### F-06 HIGH — Guard urutan status hanya membaca `data.timestamp`

Tiga probe, tiga hasil berbeda untuk hal yang seharusnya sama:

| Payload | Hasil | Arti |
|---|---|---|
| `event_timestamp` di root | `200 applied:true` | **diabaikan** |
| `data.event_timestamp` | `200 applied:true` | **diabaikan** |
| `data.timestamp` | `409 out_of_order` + `last_updated_at` | guard hidup |

Dan `updateErpOrderStatus()` (`lib/erp/order.mjs` → `updateErpOrderStatus`) mengirim `{ref, status, tracking_no}` — **tanpa timestamp sama sekali**. Jadi setiap push status dari storefront tidak pernah bisa ditolak oleh guard urutan.

Kontrol negatif yang **lulus** (supaya temuan ini kredibel): `status:"delivered"` → `422 invalid_status` dengan daftar `allowed[]` 11 nilai. Whitelist enum bekerja; urutan tidak.

### F-07 CRITICAL — Tidak ada no-regression di ERP — `sent → packed` diterima

```json
POST /api/webhooks/wms {"data":{"ref":"…","status":"packed","timestamp":"2026-10-31T06:10:00Z"}}
→ 200 {"applied":true,"effect":{"status":"packed","previous_status":"sent"}}
```

komentar di `lib/orders.ts:212` menyatakan *"ERP sendiri sudah menolak status mundur (no-regression 409)"*. Itu **tidak benar**. Satu-satunya penahan regresi adalah `applyErpStatus()` di klien (`lib/orders.ts:255`), dan itu hanya berjalan selama order masih ada di memori proses. Setelah cold start, regresi tidak terjaga.

### F-08 MEDIUM — Data liveness di ERP: sentinel `2099-01-01`

Order `ORD-WEBSTORE-PROD-2731` punya `updated_at = 2099-01-01T00:00:00Z`. Jika guard urutan aktif (dan field-nya benar), **setiap** event masa depan untuk order itu akan ditolak 409 selamanya — order beku di `sent` tanpa jalan keluar. Order `5826582` berstatus `completed` tetapi `sent_at` kosong. Keduanya cacat data, bukan cacat kode hari ini.

### F-09 LOW — Dua mode ketersediaan, satu yang menagih

`OSR_STOCK_MODE=as-is` menampilkan angka ERP apa adanya; `to-be` menghitung kapasitas komponen. ERP **memvalidasi dan memotong** memakai ekspansi BOM. Jadi klien bisa menyetujui apa yang server tolak. Di ERP live hari ini: `total_bundles 3039`, `oversell 21`, `understate 916`, `matched 2102`, contoh `1MLucky+BloomingBanquet-50ml-A1` → `stock_as_is 8110` vs `stock_to_be 23174` (`phantom −15064`).

### F-10 LOW — Reaper keranjang ada, penjadwalannya tidak

`reapCarts()` (`lib/cart-server.ts:262`) dan RPC `osr_cart_reap()` ada, tetapi tidak ada `pg_cron` yang memanggilnya. Di DB hari ini: 9 baris `osr_cart`, 7 baris item, termasuk sisa akun uji lama (`uji.cart.*`, `demo.live.*`). Tidak ada keranjang yatim (`owner_id` tanpa baris di `osr_user`) — sweep bersih.

### F-11 LOW — Fallback senyap ke file/memori

`mutateCart()` memilih backend: `if (sbConfig())` → RPC, jika tidak → file/memori (`lib/cart-server.ts:202`). Kalau env Supabase hilang di satu deployment, keranjang **tidak error**, tapi diam-diam pindah ke `/tmp` — dan keranjang terbelah dua tanpa alarm. Untuk demo ini tidak berbahaya; untuk data paper ini jenis kegagalan yang paling sulit dilacak.

---

## 7. Prioritas

**P0 — sebelum demo/paper berikutnya**

1. Deploy `19f183c` (atau minimal `26f44bf`) ke produksi sampai state **READY** di alias. Tanpa ini, semua perbaikan stok & keranjang tamu hanya ada di repo.
2. Setelah deploy: ulangi satu checkout 1 unit dan pastikan `stock_events[]` berisi `{skipped:true, reason:"erp_already_deducted"}`. Kalau tidak, field-path di `order.mjs:190` masih salah terhadap ERP.
3. Tambah ledger idempotensi stok supaya retry checkout tidak memotong lagi (F-03).

**P1**

4. Jalankan `npm run erp:sync` sebelum demo; tampilkan `fetched_at` di UI.
5. Samakan nama field timestamp (`data.timestamp`) atau kirim timestamp dari klien di setiap push status.
6. Tambah guard no-regression di ERP, bukan hanya di klien.
7. Persist order storefront (tabel Supabase), bukan `Map` proses — supaya status balik tidak butuh token.
8. Kalau push ingin difungsikan: samakan `X-Perpack-Signature` ↔ `x-osr-signature` **sebelum** set URL.

**P2**

9. Jadwalkan `osr_cart_reap()` via `pg_cron`.
10. Fallback cart: gagal keras (503) daripada pindah backend diam-diam.
11. Bersihkan `2099-01-01` dan isi `sent_at` untuk order `completed`.

---

## 8. Disclosure — apa yang saya tulis ke sistem

Audit ini tidak sepenuhnya read-only. Ini daftar lengkapnya.

| Aksi | Objek | Bisa dibalik? |
|---|---|---|
| 5× POST `/api/cart` + PATCH qty | cart uid `b614a7be…` | YA keranjang dikosongkan checkout (`count 0`) |
| 1× `POST /api/orders` | order `ORD-WEBSTORE-PROD-261031-1001-VFYU` / ERP `id 5826585` | [!] record bisa di-cancel, **stok tidak** |
| 1× POST `purchase-order` ulang (idempotensi) | ref yang sama | YA `applied:false`, order tetap 1 |
| 4× `order.status_changed` | order yang sama | [!] status berakhir `sent` (bukan `paid`) |
| 1× `status:"delivered"` | ditolak | YA tidak ada efek |

**Efek residu yang tidak bisa dikembalikan lewat API:**

- Stok `M2291` di ERP: **9975 → 9973** (−2). ERP tidak punya endpoint pengembalian stok; `delta` negatif adalah no-op. Perlu koreksi manual di DB.
- Order `5826585` tetap ada di ERP dengan status `sent`, `awb` kosong, customer `AUDIT-PROBE-HERMES`. Silakan cancel manual kalau tidak ingin masuk hitungan.

Dua baris ini juga bukti, bukan cuma catatan: ketiadaan jalur pembatalan stok itulah F-02.

Tidak ada perubahan pada kode, tidak ada deploy, tidak ada file di repo yang disentuh.

---

## 9. Reproduksi

```bash
B=https://bpi-simulation-webstore-eosin.vercel.app
E=https://web-production-e60b55.up.railway.app

# cart: 4 lapis
curl -s -c jar -X POST $B/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ditoibrahim47@gmail.com","password":"211Bantilan21"}'
curl -s -b jar $B/api/cart | jq '{backend,count}'
seq 5 | xargs -P5 -I{} curl -s -b jar -X POST $B/api/cart \
  -H 'Content-Type: application/json' -d '{"sku":"M2291","qty":1}' -o /dev/null
curl -s -b jar $B/api/cart | jq '.count'          # harus 5

# stok: snapshot vs live
curl -s "$B/api/catalog/stock?skus=M2291" | jq '.items[0].stockDisplay'
curl -s "$E/api/webhooks/catalog?page=1&length=250" | jq '[.data.products[]|select(.sku=="M2291")|.stock_available]'

# jalur B + C
curl -s -b jar -X POST $B/api/orders -H 'Content-Type: application/json' \
  -d '{"customer":{"name":"AUDIT"},"shipping":{"courier":"sicepat"}}' | jq '.integration'
curl -s -X POST $E/v1/orders/page -H 'Content-Type: application/json' \
  -d '{"page":1,"length":5,"search":"ORD-WEBSTORE-PROD-"}' | jq '.data[0]'
curl -s "$B/api/orders/<REF>?k=<TOKEN>" | jq '{status,sync,erp}'

# push mati
curl -s $E/api/push-outbox | jq '.data'
```

---

## 10. Yang masih saya butuhkan

1. **Izin deploy** — saya tidak men-deploy apa pun. Perintahnya ada, eksekusinya milik kamu.
2. **Keputusan soal residu** — order `5826585` dibiarkan `sent`, atau di-cancel manual?
3. **Status katalog** — untuk paper, apakah angka TO-BE harus dari ERP live atau boleh snapshot asal `fetched_at` dicatat?