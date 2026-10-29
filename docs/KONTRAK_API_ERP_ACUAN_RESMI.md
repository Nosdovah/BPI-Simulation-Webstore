# Kontrak API ERP ↔ Webstore — Acuan Resmi

**Versi:** 1.0
**Tanggal penetapan:** 29 Oktober 2026
**Status:** **DITETAPKAN** sebagai satu-satunya acuan resmi integrasi ERP ↔ Webstore
**Menggantikan:** usulan *adapter pattern* (`OSR_CATALOG_SOURCE=wms|erp`) dan seluruh asumsi Jalur A pada `BLUEPRINT_SIMULASI` v0.2

---

## 1. Penetapan

### 1.1 Dokumen sumber

Acuan resmi ini diturunkan dari:

| Item | Nilai |
|---|---|
| Dokumen | `docs/PANDUAN_KONEKSI_ERP_WEBSTORE.md` versi **2.0** (28 Okt 2026) |
| SHA-256 dokumen | `15299d4c9eaa09202aa8001be4c73c37a8584dee90f4109209aeec75d60da62f` |
| PDF turunan | `docs/PANDUAN_KONEKSI_ERP_WEBSTORE.pdf` · SHA-256 `daecb68e5b24a38e806f65bda44aac6ae18eb1f7d25f120d98024733daecc256` |
| Repo ERP | `Nosdovah/BPI-Simulation-ERP` |
| **Branch pin** | `feat/api-v1-v2-contract` |
| **Commit pin** | `e611d34171a2316acb4969d6dcc724256d755636` (2026-10-28 10:05:31 +0800) |
| Repo webstore | `Nosdovah/BPI-Simulation-Webstore` |

### 1.2 Apa yang resmi

1. **Bab §5 dokumen sumber** (kontrak API) — seluruh path, method, bentuk request/response, envelope, dan kode error — adalah **acuan resmi**. Dokumen ini menyalin dan memverifikasinya, bukan menafsir ulang.
2. **Branch/commit pin di §1.1** adalah satu-satunya lineage ERP yang sah untuk simulasi. Kontrak tidak berlaku untuk commit lain tanpa verifikasi ulang (§11).
3. Bila dokumen sumber dan dokumen ini berbeda, **dokumen ini yang berlaku** untuk bagian yang sudah diverifikasi ulang (lihat register drift §10).

### 1.3 Apa yang tidak resmi

- Usulan *adapter pattern* (`adapter_base.py` / `adapter_wms.py` / `adapter_erp.py`, toggle `OSR_CATALOG_SOURCE`) — **gugur**. ERP sudah menjadi *system of record*; tidak ada dua sumber katalog yang perlu diabstraksi.
- Asumsi bahwa WMS Perpack dipanggil langsung oleh webstore — **gugur**. Webstore hanya mengenal ERP.
- Angka katalog/harga/BOM yang ditulis tangan di kode — **gugur**. Semua berasal dari `/api/v2/*`.

### 1.4 Pembagian peran (mengikat)

- **ERP** = *system of record*: SKU, nama, segmen, harga, BOM, saldo stok, gudang, status order.
- **Webstore** = konsumen data + titik masuk pelanggan. **Tidak** menyimpan master data, **tidak** menulis stok.
- **Webstore core** = penerima event `order.status_changed` / `stock.updated`, penegak idempotensi dan enum baku.

**Aturan keras:**

1. Webstore **tidak boleh** memanggil ERP di request path. Default `OSR_CATALOG_SOURCE=snapshot`; angka demo deterministik dan dapat diaudit lewat checksum.
2. Semua mutasi stok dan status **hanya** lewat `/api/v1/*`. Tidak ada komponen yang menulis langsung ke SQLite.
3. Event keluar ERP **hanya** lewat satu titik: `post_webhook()` di `apps/wms-stub/main.py`.

---

## 2. Peta keluarga endpoint

| Prefix | Peran | Implementasi (ERP) | Pemanggil | Bentuk respons |
|---|---|---|---|---|
| `/api/v1/*` | **Eksekusi** — hitung BOM, checkout atomik, transisi status, audit webhook | `apps/wms-stub/main.py` | storefront checkout, skrip uji, admin | `{code, msg, data}` |
| `/api/v2/*` | **Read-model** — master, saldo, BOM, gudang | `apps/wms-stub/compat.py` | `lib/erp/pull.mjs` (`npm run erp:sync`) | flat `{count, ...}` |
| `/api/webhooks/wms` | **Receiver** event keluar ERP | `app/api/webhooks/wms/route.ts` (webstore) | `post_webhook()` di ERP | `{ok, ...}` |
| `/v1/open/*` | Panel admin legacy (ringkasan, list order, event, kuota) | `apps/wms-stub/main.py` | `osr-admin` :3001 | `{code, msg, data}` |

**Aturan pemisahan:** `/api/v1/*` mengubah state — kecuali dua endpoint baca (`inventory/{sku}`, `audit/webhook-logs`). `/api/v2/*` **tidak pernah** mengubah state; murni `SELECT` dari SQLite yang sama.

**Bukti:** `GET /openapi.json` pada commit pin memuat **17 path**, termasuk 4 endpoint `/api/v1/*`, 7 endpoint `/api/v2/*`, 4 endpoint `/v1/open/*`, `/healthz`, dan `/api/webhooks/wms`.

---

## 3. Envelope, konten, dan error

| Aspek | Aturan |
|---|---|
| Base URL lokal | `http://127.0.0.1:8100` |
| Content-Type | `application/json` |
| `/api/v1/*` | `{"code":200,"msg":{"id":"Sukses","en":"Success"},"data":{...}}` |
| `/api/v2/*` | **tanpa envelope** — langsung `{"count":N,"items":[...]}` |
| Error | format bawaan FastAPI `{"detail":"..."}` + status HTTP 4xx/5xx, **tidak** dibungkus envelope |
| Pengecualian wajib ingat | `POST /api/v1/storefront/checkout` mengembalikan objek **tanpa envelope**: `message, order_ref, status, updated_by, sla_seconds` |

> Konsekuensi praktis: pemanggil **wajib** memeriksa HTTP status, bukan hanya field `code`. Kesalahan klasik `expected object, got array` terjadi karena lupa membuka `data` pada keluarga v1.

---

## 4. Jalur A — read-model `/api/v2/*`

Tujuh endpoint, semuanya `GET`, semuanya menerima `limit` (products/balances: 1–50.000). Kolom `count` terverifikasi pada commit pin, mode `tobe`.

| Endpoint | Field penting | `count` |
|---|---|---|
| `/api/v2/master/products?limit=5000` | `id, sku, name, brand, category, item_type, specs, stock, unit_price, is_assembly` | **3.696** |
| `/api/v2/inventory/balances?limit=5000` | `sku, stock_on_hand, allocated, available, on_order, bin_code` | **3.664** |
| `/api/v2/inventory/by-warehouse` | `sku, warehouse_id, warehouse_name, available, reserved, on_order` | **7.325** |
| `/api/v2/assembly/boms` | `target_sku, version, source, labor_cost, overhead_cost, components[{component_sku, qty, unit_price, scrap_pct}]` | **1** (tobe) / **0** (baseline) |
| `/api/v2/assembly/bundle-stock` | `bundle_sku, quota_static, components[], stock_from_components, phantom` | **0** di tobe |
| `/api/v2/master/warehouses` | `id, code, name, type` | **3** |
| `/api/v2/master/operational` | `min_stock, max_stock, reorder_point` | **0** |

Catatan kontrak yang mengikat:

- `products.id` = `sku`. Webstore memetakan `id → sku`.
- `brand` berisi segmen gender (`MEN`/`WOMEN`/`UNISEX`) karena itu yang dipakai filter UI; `category` = `BUNDLING` / `EAU DE PARFUM`.
- **3.664 < 3.696 bukan bug**: 32 SKU belum punya baris stok; webstore menampilkan stok 0 apa adanya.
- `assembly/bundle-stock` kosong di mode `tobe` karena `bundle_quota_manual` memang tidak diisi. Angka phantom hanya ada di baseline.
- `master/operational` sengaja kosong: ERP belum menyimpan parameter itu. `count: 0`, bukan angka karangan.
- `boms.source` = `PERPACK_API`, `version` = `BOM-v2`, `labor_cost`/`overhead_cost` = 0.
- Tidak ada fallback yang mengarang: field kosong tampil kosong.

**Pemanggil:** `lib/erp/pull.mjs` → lima endpoint (products, balances, boms, warehouses, operational) → `catalog.snapshot.json` + `manifest.json` ber-checksum.

---

## 5. Jalur B — eksekusi `/api/v1/*`

### 5.1 `GET /api/v1/inventory/{sku}`

- Non-bundle: stok fisik `SUM(stocks.available)`.
- Bundle: `MIN(floor(stok_komponen / multiplier))` per komponen di `sku_bom`.
- Baseline: bundle tanpa BOM → `available_stock: 0`, `components: []` — bukan angka karangan.
- `404` bila SKU tidak ada.

```json
{"code":200,"msg":{"id":"Sukses","en":"Success"},"data":{
  "sku":"Sanctum+Noctis-20ml-A1",
  "name":"Sanctum + Noctis - Bundling 2 Botol 20mL",
  "is_bundle":true,
  "available_stock":10932,
  "components":[
    {"component_sku":"M2291","stock_available":11927,"multiplier":1},
    {"component_sku":"M2292","stock_available":10932,"multiplier":1}]}}
```

### 5.2 `POST /api/v1/storefront/checkout`

Request:

```json
{"order_ref":"ORD-2026-0001","channel":"WEBSTORE",
 "items":[{"sku":"M2291","qty":2}]}
```

Perilaku dalam satu transaksi `BEGIN IMMEDIATE`:

1. Validasi SKU; `404` kalau tidak ada.
2. Bundle → potong **komponen** (`qty × multiplier`); bundle tanpa BOM → `409 bundle <sku> tanpa relasi BOM (baseline)`.
3. Non-bundle → potong stok SKU itu sendiri.
4. `INSERT orders` (status `paid`, `paid_at`/`processing_at` = now) + `order_items`.
5. **Zero-Click:** status langsung `process`, `actor_last='SYSTEM'`, `order_status_history` (`source=CHECKOUT`), SLA 5 detik.
6. Commit → webhook `order.status_changed` dikirim sebagai *background task*.

Respons (**tanpa envelope**, **tanpa** `order_id` internal — pakai `order_ref` sebagai kunci):

```json
{"message":"Pesanan terbayar dan otomatis diproses ke gudang (Zero-Click).",
 "order_ref":"ORD-2026-0001","status":"process","updated_by":"SYSTEM","sla_seconds":5.0}
```

### 5.3 `POST /api/v1/wms/orders/{order_ref}/transition`

Query: `target_status` (wajib), `tracking_number` (opsional).

Alur baku: `paid → process → pick → packing → packed → ready_to_pickup → sent → completed`.
Terminal: `cancelled`, `returned`, `completed`.

| Kondisi | HTTP | Body |
|---|---|---|
| Status tidak dikenal (`on_process`) | `422` | `{"detail":"enum status tidak dikenal"}` |
| Order tidak ada | `404` | `{"detail":"order tidak ditemukan"}` |
| Order sudah terminal | `409` | `{"detail":"order terminal — immutable"}` |
| Status mundur (`packed → paid`) | `409` | `{"detail":"no-regression: status tidak boleh mundur"}` |

Respons sukses:

```json
{"code":200,"msg":{"id":"Sukses","en":"Success"},"data":{
  "order_ref":"ORD-2026-0001","from":"process","to":"packed",
  "updated_by":"SYSTEM","webhook_sent":true,"webhook_status":null}}
```

`webhook_status` = `null` karena pengiriman *background task*; status HTTP sebenarnya ada di `GET /api/v1/audit/webhook-logs`. `updated_by` = `COURIER` untuk `sent`/`completed`, `SYSTEM` untuk lainnya.

### 5.4 `GET /api/v1/audit/webhook-logs?limit=100`

```json
{"code":200,"msg":{"id":"Sukses","en":"Success"},"data":[
 {"id":1,"event_id":"evt_wms_status_20261028_100221_941",
  "event":"order.status_changed","lane":"4.2","attempt":1,
  "http_status":202,"signature":"sha256=5afbb0e74167…",
  "sent_at":"2026-10-28 02:02:21"}]}
```

Tabel sumber: `webhook_delivery_log` (`event_id, event, lane, attempt, http_status, signature, sent_at`). **Ini bukti audit yang dipakai di bab hasil paper**: jumlah event, status HTTP, dan tanda tangan HMAC.

---

## 6. Webhook keluar — kontrak receiver `POST /api/webhooks/wms`

| Item | Nilai |
|---|---|
| Auth | `Authorization: Bearer <OSR_WEBHOOK_TOKEN>` |
| Alternatif auth | `X-OSR-Webhook-Token: <token>` atau `?token=` |
| Signature (nama kontrak v2) | `X-Perpack-Signature: sha256=<hmac_sha256(raw_body, secret)>` |
| Alias signature (dibaca receiver) | `X-OSR-Signature: sha256=<...>` |
| Dedupe | `event_id` → fallback `Idempotency-Key` (diisi ERP = `event_id`) → fallback hash body |
| Idempotensi | kunci `evt:<event>:<event_id>` dan `idem:<event_id>` |

Status code receiver: `202` diterima · `200` duplikat · `400` body invalid/kosong (`EMPTY_BODY`) · `401` token/signature salah (`UNAUTHORIZED`) · `422` tanpa field `event` · `503` token server belum diset.

Event yang punya efek di core:

| Event | Efek |
|---|---|
| `stock.updated` / `inventory.updated` | menambah "terjual" komponen → stok bundle turun (hanya mode `tobe`) |
| `order.status_changed` / `order.updated` | memperbarui status + tracking order yang dikenal core |
| `ping` / `health.check` | di-ack, tanpa efek |

### 6.1 Dua field status, dua semantik — keduanya wajib ada

- `previous_status` / `current_status` = **enum internal ERP**: `paid, process, pick, packing, packed, ready_to_pickup, sent, completed, cancelled, returned`.
- `status` = **enum baku receiver**: `PAID, PROCESSING, PICKING, PACKED, HANDOVER_TO_COURIER, IN_TRANSIT, ARRIVED_AT_HUB, OUT_FOR_DELIVERY, DELIVERED, COMPLETED`, plus warisan baseline `SENT`, `on_process`.

Pemetaan (`STATUS_ENUM_MAP` di ERP):

| ERP | Receiver |
|---|---|
| `paid` | `PAID` |
| `process`, `packing` | `PROCESSING` |
| `pick` | `PICKING` |
| `packed` | `PACKED` |
| `ready_to_pickup` | `HANDOVER_TO_COURIER` |
| `sent` | `IN_TRANSIT` |
| `completed` | `COMPLETED` |
| `cancelled` / `returned` | `CANCELLED` / `RETURNED` |

> `on_process` adalah enum **tidak baku** dari data produksi dan ditolak mapper (`UNKNOWN_ENUM`). Itu **cacat yang direproduksi seeder**, bukan sesuatu yang perlu "diperbaiki" di receiver. Memperbaikinya di receiver akan menghapus bukti defect.

### 6.2 Catatan traceability (penting untuk bab hasil)

Receiver mencatat `apply_note: "order <ref> tidak dikenal di core (diabaikan)"` ketika `order_ref` dibuat langsung di ERP, bukan lewat checkout webstore. Artinya event tetap **diterima, ditandatangani, dan tersimpan**, tetapi state UI tidak berubah. **Order uji DMAIC wajib dibuat lewat checkout webstore** supaya rantai bukti utuh dari klik pelanggan sampai status akhir.

---

## 7. Autentikasi dan matriks secret

| Keluarga | Token | Perilaku terverifikasi |
|---|---|---|
| `/api/v2/*` | `OSR_ERP_SERVICE_TOKEN` (ERP) ↔ `OSR_ERP_TOKEN` (webstore) | Kalau ERP tidak menyetel token, request tanpa header tetap `200`. Kalau disetel, wajib `Authorization: Bearer <token>` yang sama; selain itu `401 Token service ERP tidak valid` |
| `/api/v1/*` | tidak ada token (loopback saja) | **jangan** diekspos ke jaringan publik |
| `/api/webhooks/wms` | `OSR_WEBHOOK_TOKEN` (webstore) ↔ `WEBHOOK_TOKEN` (ERP) | `202` diterima, `401` token/signature salah |

Pasangan secret yang harus identik di kedua sisi:

```
ERP:      WEBHOOK_TOKEN          <->  Webstore: OSR_WEBHOOK_TOKEN
ERP:      WEBHOOK_SECRET         <->  Webstore: OSR_WEBHOOK_HMAC_SECRET
ERP:      OSR_ERP_SERVICE_TOKEN  <->  Webstore: OSR_ERP_TOKEN
```

> Uji 28 Okt: `curl -H "Authorization: Bearer <salah>" /api/v2/master/products?limit=1` → `200`, karena `OSR_ERP_SERVICE_TOKEN` tidak disetel di server. **Jangan** menyimpulkan "token jalan" dari hasil ini — setel token di kedua sisi lalu uji ulang.

---

## 8. Pemetaan field ERP → `Product` storefront

| Field storefront | Sumber ERP | Catatan |
|---|---|---|
| `sku` | `products.sku` | kunci utama |
| `name` | `products.name` | — |
| `gender` | `products.brand` | dipakai filter segmen |
| `collection` | `products.item_type` | `SINGLE` → `single`, `BUNDLE` → `bundle` |
| `priceIdr` | `products.unit_price` | fallback `wholesale_price` |
| `baselineQuota` | `balances.stock_on_hand` | angka ERP apa adanya |
| `description` | `products.specs` | — |
| `isBundle` | ada di `boms.target_sku` | — |
| `components[]` | `boms.components[]` | `multiplierQty` = `qty` |
| `priceIdr` bundle | Σ(`unit_price` × `qty`) + `labor_cost` + `overhead_cost` | **dihitung**, bukan disimpan |

---

## 9. Bukti verifikasi

Dijalankan **29 Oktober 2026, 08:43–08:48 UTC** terhadap commit pin `e611d34`, database hasil `OSR_MODE=tobe python db/seed.py`, port `8100`, receiver dummy `:3999`.

### 9.1 Seed gate (angka baseline harus identik produksi)

```
[seed] mode=tobe | variants=3696 | stocks=7325 | sku_bom=2
[seed] Modul A: kuota statis 10.932 vs M2291 11.927 / M2292 10.932 -> phantom 995
[seed] Modul B: 82 macet 'sent' (>2hri 21) | 57 completed manual
[seed] Modul C: 103 event | valid 20 (19.4%) | DPMO 805,825
```

### 9.2 Hasil 18 gate kontrak

| # | Gate | Hasil |
|---|---|---|
| 1 | `GET /healthz` → `ok:true`, `mode:tobe` | LULUS |
| 2 | `/api/v2/master/products` `count=3696` | LULUS |
| 3 | `/api/v2/inventory/balances` `count=3664` | LULUS |
| 4 | `/api/v2/assembly/boms` `count=1` | LULUS |
| 5 | `/api/v2/master/warehouses` `count=3` | LULUS |
| 6 | `/api/v2/master/operational` `count=0` | LULUS |
| 7 | `/api/v2/inventory/by-warehouse` `count=7325` | LULUS |
| 8 | `/api/v2/assembly/bundle-stock` `count=0` (tobe) | LULUS |
| 9 | `GET /api/v1/inventory/{bundle}` = `10932`, 2 komponen, envelope `code` | LULUS |
| 10 | `GET /api/v1/inventory/{unknown}` → `404` | LULUS |
| 11 | `POST /storefront/checkout` → `200`, `status=process`, `updated_by=SYSTEM`, **tanpa envelope** | LULUS |
| 12 | Stok `M2291` terpotong `11927 → 11925` (qty 2) | LULUS |
| 13 | `POST transition packed` → `process→packed`, `webhook_sent:true` | LULUS |
| 14 | `transition → paid` → `409 no-regression` | LULUS |
| 15 | `transition → on_process` → `422 enum tidak dikenal` | LULUS |
| 16 | `transition` order tak dikenal → `404` | LULUS |
| 17 | `GET /api/v1/audit/webhook-logs` → baris + `signature: sha256=…` | LULUS |
| 18 | `/openapi.json` memuat 6 endpoint kunci dari 17 path | LULUS |

**18/18 LULUS.**

### 9.3 Rantai Jalur B end-to-end (keluaran nyata)

```
checkout          -> 200 status=process by=SYSTEM
transition pick     -> 200 process->pick    webhook_sent=True
transition packing  -> 200 pick->packing    webhook_sent=True
transition packed   -> 200 packing->packed  webhook_sent=True

audit/webhook-logs -> 200 n=6
  #6 order.status_changed lane=4.2 attempt=1 http=202 sig=sha256=5013ed1ed5a5…
  #5 order.status_changed lane=4.2 attempt=1 http=202 sig=sha256=ac255f435ccb…
  #4 order.status_changed lane=4.2 attempt=1 http=202 sig=sha256=999c57ac36bb…
  #3 order.status_changed lane=4.2 attempt=1 http=202 sig=sha256=12e98338e6ba…
  #2 order.status_changed lane=4.2 attempt=1 http=0   sig=sha256=e89d96f47712…
  #1 order.status_changed lane=4.2 attempt=1 http=0   sig=sha256=be44d6694495…
```

Baris `#1`–`#2` tercatat `http_status: 0` karena receiver belum hidup saat itu — **temuan baru**, lihat §10.3.

---

## 10. Register drift (dokumen sumber vs kenyataan hari ini)

Tiga penyimpangan ditemukan saat verifikasi. Semuanya sudah ditutup di dokumen ini; dokumen sumber **tidak** diubah (milik alur dokumentasi lain).

### 10.1 Lineage `main` tidak punya Jalur B — RISIKO TERTINGGI

| | `main` @ `3599e82` | `feat/api-v1-v2-contract` @ `e611d34` (pin) |
|---|---|---|
| `/api/v2/*` (read-model) | **ADA** (`compat.py` ter-mount) | ADA |
| `/api/v1/*` (engine) | **TIDAK ADA — 0 endpoint** | ADA (4 endpoint) |
| `sales-order` / `checkout` / `transition` | **TIDAK ADA** | ADA |
| Jalur A (katalog) | jalan | jalan |
| **Jalur B (order)** | **GAGAL** — gateway webstore tidak menemukan endpoint tulis | jalan |

**Konsekuensi operasional:** kalau ERP dijalankan dari `main`, katalog tetap tampil (sehingga terlihat "normal"), tetapi **checkout gagal** dan seluruh simulasi Jalur B/DMAIC tidak bisa direproduksi. Karena itu pin branch/commit di §1.1 bersifat **mengikat**, bukan saran.

> Dokumen sumber §10 menyatakan `main` "belum menyediakan `/api/v2/*`". Itu **sudah tidak akurat**: `main` kini menyediakan v2, yang hilang justru v1. Arah drift-nya terbalik dari yang tertulis.

### 10.2 Dualitas `baseline` / `tobe` hanya berlaku di ERP, bukan di webstore

Dokumen sumber §4 dan §7 masih menyebut webstore punya perilaku "mode `baseline` → angka diam". Sejak commit webstore `8cf22fb` (*"Sederhanakan webstore ke satu alur proses: hapus mode baseline dan label simulasi/sandbox"*), webstore **tidak lagi** punya mode baseline.

**Penetapan:** dualitas `baseline`/`tobe` adalah **milik ERP** (`db/seed.py`, `OSR_MODE`) dan tetap sah sebagai mekanisme *before → after*. Webstore selalu berperilaku tunggal dan hanya membaca apa pun yang disajikan ERP. Perbandingan before/after dilakukan dengan **menukar seed ERP + sync ulang**, bukan dengan mengubah mode webstore.

### 10.3 `http_status: 0` = kegagalan koneksi, tercatat di audit log

Belum terdokumentasi di sumber. Bila receiver tidak dapat dihubungi, `webhook_delivery_log` tetap menulis baris dengan `http_status: 0` dan signature valid.

**Implikasi untuk paper:** audit log **tidak** boleh dibaca sebagai "semua event terkirim". Filter wajib: `http_status = 202` untuk hitungan sukses; `0` = gagal koneksi; `4xx/5xx` = ditolak receiver. Ini memperkuat argumen DPMO — kegagalan pengiriman event memang bagian dari defect, bukan anomali alat ukur.

---

## 11. Aturan perubahan (change control)

1. Setiap perubahan kontrak di ERP **wajib** menaikkan versi dokumen ini dan mencatat commit pin baru di §1.1.
2. Sebelum versi baru ditetapkan, jalankan `node scripts/verify-api-contract.mjs` — **18/18 harus LULUS**. Kontrak yang gagal gate tidak boleh dijadikan acuan.
3. Perubahan berikut dianggap **breaking** dan wajib versi mayor: menghapus/mengganti path, mengubah envelope, mengubah nama field, mengubah kode error, mengubah enum.
4. Penambahan field opsional atau endpoint baru = versi minor.
5. `docs/api-contract.erp.v2.json` adalah representasi mesin dari dokumen ini. Keduanya harus sinkron; bila berbeda, **JSON yang dipakai skrip** dan selisihnya harus dilaporkan.

---

## 12. Konsekuensi arsitektural — apa yang gugur dari blueprint v0.2

| Asumsi blueprint v0.2 | Status setelah penetapan |
|---|---|
| Jalur A = `Webstore ← Modul 4.1 (WMS Perpack)` langsung | **GUGUR** → `Webstore ← ERP /api/v2/*` (snapshot) |
| Perlu adapter `wms|erp` karena ada dua sumber katalog | **GUGUR** → satu sumber: ERP |
| Katalog di-push dari WMS (`POST /v1/open/catalog/push`) | **GUGUR** → katalog **ditarik** (`pull`), push hanya stub kompatibilitas |
| Jalur B = webhook receiver saja | **TIDAK LENGKAP** → Jalur B = `checkout → transition → webhook → audit log` |
| Stok bundle dihitung di webstore | **PINDAH** → dihitung ERP (`MIN(floor(stok/multiplier))`), webstore hanya menampilkan |
| Webstore menulis stok | **GUGUR** → mutasi stok hanya lewat `/api/v1/*` di ERP |
| Tabel `variants`, `bundle_components`, `stocks` di DB webstore | **TIDAK PERLU** → digantikan snapshot ber-checksum |

**Yang tetap sah dari blueprint v0.2:** fault injector F1–F7 (dipetakan 1:1 ke FMEA), gate reproduksi baseline (103 event / 82 macet / 21 >2 hari / 57 manual / DPMO 805.825), seed `20260918`, dan prinsip satu titik integrasi.

---

## 13. Lampiran — berkas yang terlibat

**ERP** (`~/bpi-simulation-erp`, pin `e611d34`)

```
apps/wms-stub/main.py           engine v2: /api/v1/*, webhook keluar HMAC, /v1/open/*
apps/wms-stub/compat.py         read-model /api/v2/*
db/schema.sql                   skema SQLite (variants, sku_bom, stocks, orders, …)
db/seed.py                      seeder per mode (baseline | tobe)
scenario/reproduce_baseline.py  verifikasi angka baseline
```

**Webstore** (`~/BPI-Simulation-Webstore`)

```
lib/erp/pull.mjs                puller /api/v2/* (retry, timeout, integrity, checksum)
lib/erp/order.mjs               gateway Jalur B (deteksi kontrak via /openapi.json)
lib/erp/snapshot.ts             cache + reload saat mtime berubah
lib/erp/mapper.ts               ERP -> Product[]
lib/webhooks.ts                 receiver: auth, HMAC, dedupe, mapper enum
app/api/webhooks/wms/           route GET (probe/counter) + POST (event masuk)
scripts/erp-sync.mjs            CLI npm run erp:sync
scripts/verify-api-contract.mjs 18 gate kontrak (dokumen ini §9)
docs/api-contract.erp.v2.json   kontrak versi mesin
```

---

*Dokumen ini menetapkan bab §5 `PANDUAN_KONEKSI_ERP_WEBSTORE.md` v2.0 sebagai acuan resmi, dengan pin lineage, bukti verifikasi 18/18, dan register drift. Setiap penyimpangan dari dokumen ini harus melalui §11.*
