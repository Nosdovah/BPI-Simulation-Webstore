# Panduan Koneksi ERP ↔ Webstore

**Proyek:** OSR / Octarine Sandbox — BPI DMAIC
**Versi:** 2.0 · 28 Oktober 2026
**Pasangan repo:** `Nosdovah/BPI-Simulation-ERP` (engine ERP/WMS v2) ↔ `Nosdovah/BPI-Simulation-Webstore` (storefront Next.js 14)
**Status verifikasi:** seluruh endpoint di §5, §6, dan §8 dijalankan ulang dan lulus pada **28 Okt 2026, 10:00–10:06 WIB** (02:00–02:06 UTC). Keluaran nyata dikutip apa adanya di dokumen ini.

> **Yang berubah di v2.0:** bab kontrak ditulis ulang total. Dokumen v1.1 hanya mendokumentasikan `/api/v2/*` (read-model) dan menaruh Jalur B di webhook receiver saja. Kenyataannya engine ERP v2 punya **dua keluarga endpoint**: `/api/v1/*` untuk eksekusi (checkout, transisi status, hitung BOM, audit) dan `/api/v2/*` untuk pembacaan master data oleh storefront. Keduanya kini dijabarkan field-per-field, termasuk perbedaan bentuk envelope dan kode error. Lihat §13 untuk daftar perubahan.

> **Cakupan dokumen (wajib dibaca sebelum eksekusi):** dokumen ini mendokumentasikan engine ERP pada branch **`feat/api-v1-v2-contract`** (commit `e611d34`), yaitu engine dengan `/api/v1/*` + read-model `/api/v2/*`. `origin/main` repo ERP sudah bergerak ke lineage lain — *replika API Perpack* (`GET /v1/products/group/page`, `GET /v1/products/list`, `POST /v1/orders/page`, `GET /v1/channels`, `GET /v1/warehouses`, auth JWT) — yang **belum** menyediakan `/api/v2/*`. Konsekuensinya: `npm run erp:sync` hanya jalan terhadap branch di atas sampai kedua lineage direkonsiliasi. Jangan menganggap main = dokumen ini.

---

## 1. Ringkasan

Integrasi terdiri dari **dua jalur berlawanan arah**, dan keduanya wajib jalan sebelum simulasi DMAIC dianggap valid.

```
        JALUR A — master data (ERP -> Webstore, arah BACA)
        +----------------------------+
        |  ERP / WMS engine v2       |
        |  apps.wms-stub  :8100      |
        |  GET /api/v2/master/*      |
        |  GET /api/v2/inventory/*   |
        |  GET /api/v2/assembly/*    |
        +-------------+--------------+
                      |  npm run erp:sync  (tarik, snapshot)
                      v
        .data/erp/catalog.snapshot.json + manifest.json (checksum)
                      |  baca tanpa network saat request
                      v
        +----------------------------+
        |  Webstore Next.js  :3000   |
        +-------------+--------------+
                      |
        JALUR B — order & status (arah TULIS + event balik)
                      |
                      |  1. POST /api/v1/storefront/checkout
                      |     -> potong stok atomik + Zero-Click (paid -> process)
                      |  2. POST /api/v1/wms/orders/{ref}/transition
                      |     -> state machine + no-regression
                      v
        +----------------------------+
        |  ERP state machine         |
        |  orders / order_status_*   |
        +-------------+--------------+
                      |  3. webhook keluar, HMAC-SHA256
                      |  POST /api/webhooks/wms
                      v
        +----------------------------+
        |  Webstore core (receiver)  |  -> dedupe -> enum baku -> state UI
        +----------------------------+
```

**Pembagian peran:**

- **ERP** = *system of record*: SKU, nama, segmen, harga, BOM, saldo stok, gudang, status order.
- **Webstore** = konsumen data dan titik masuk pelanggan. Tidak menyimpan master data, tidak menulis stok.
- **Webstore core** = penerima event `order.status_changed` / `stock.updated`, menegakkan idempotensi dan enum baku.

**Aturan keras:**

1. Webstore **tidak boleh** memanggil ERP di request path. Default `OSR_CATALOG_SOURCE=snapshot`; angka demo deterministik dan bisa diaudit lewat checksum.
2. Semua mutasi stok dan status **hanya** lewat `/api/v1/*`. Tidak ada komponen yang menulis langsung ke SQLite.
3. Event keluar ERP **hanya** lewat satu titik: `post_webhook()` di `apps/wms-stub/main.py` — supaya audit `webhook_delivery_log` lengkap dan fault injector cukup menyentuh satu tempat.

---

## 2. Prasyarat

| Kebutuhan | Versi / catatan |
|---|---|
| Python | 3.11 (venv di `~/bpi-simulation-erp/.venv`) |
| Node.js | 18+ (webstore Next.js 14) |
| Port | `8100` ERP · `3000` webstore · `3001` admin panel (opsional) |
| Database | SQLite `~/bpi-simulation-erp/db/wms.db` (di-seed, bukan dibuat manual) |
| Network | loopback saja; tidak butuh internet |
| Env | `OSR_WEBHOOK_TOKEN`, `OSR_WEBHOOK_HMAC_SECRET` di webstore `.env.local`; `WEBHOOK_TOKEN`, `WEBHOOK_SECRET` di ERP |

Database **tidak** ikut repo (`db/*.db` di-ignore). Kalau hilang, jalankan seeder (§4).

---

## 3. Menjalankan ERP

```bash
cd ~/bpi-simulation-erp
. .venv/bin/activate

export OSR_MODE=tobe
export WEBHOOK_URL=http://127.0.0.1:3000/api/webhooks/wms
export WEBHOOK_SECRET="$(grep -E '^OSR_WEBHOOK_HMAC_SECRET=' \
  ~/BPI-Simulation-Webstore/.env.local | cut -d= -f2- | tr -d '\r\n ')"
export WEBHOOK_TOKEN="$(grep -E '^OSR_WEBHOOK_TOKEN=' \
  ~/BPI-Simulation-Webstore/.env.local | cut -d= -f2- | tr -d '\r\n ')"

uvicorn apps.wms-stub.main:app --host 127.0.0.1 --port 8100
```

Cek hidup:

```bash
curl -s http://127.0.0.1:8100/healthz
# {"ok":true,"service":"osr-wms (ERP Simulator v2)","mode":"tobe"}
```

> `WEBHOOK_SECRET` kosong **tidak** mematikan ERP, tetapi webhook keluar ditandatangani dengan secret default `osr-local-hmac-secret` dan akan ditolak receiver bila receiver punya secret lain. Selalu samakan nilainya.
>
> **Jangan** menjalankan `main.py` di root repo. Itu engine v1 legacy (`/v1/open/*`, skema tabel `bundle_components`) dan akan gagal di atas skema v2 (`sku_bom`).

---

## 4. Seed per mode (langkah yang paling sering terlewat)

Mode **bukan** hanya flag runtime — data harus ikut di-seed. Menjalankan server `OSR_MODE=tobe` di atas database hasil seed baseline akan menghasilkan **0 BOM**, dan simulasi to-be tidak membuktikan apa pun.

```bash
cd ~/bpi-simulation-erp
. .venv/bin/activate

OSR_MODE=tobe python db/seed.py       # perbaikan: BOM aktif, kuota statis mati
OSR_MODE=baseline python db/seed.py   # cacat direproduksi: BOM 0 baris, kuota manual
```

Seeder **menghapus** `db/wms.db` lalu membangun ulang. Backup dulu kalau ada state manual:

```bash
cp db/wms.db /tmp/wms.$(date +%s).bak
```

Keluaran nyata (mode `tobe`, 28 Okt 10:03 WIB):

```
[seed] mode=tobe | variants=3696 | stocks=7325 | sku_bom=2
[seed] Modul A: kuota statis 10.932 vs M2291 11.927 / M2292 10.932 -> phantom 995
[seed] Modul B: 82 macet 'sent' (>2hri 21) | 57 completed manual
[seed] Modul C: 103 event | valid 20 (19.4%) | DPMO 805,825
```

Perbedaan mode:

| Aspek | `baseline` | `tobe` |
|---|---|---|
| `sku_bom` | 0 baris | 2 baris (bundle ← M2291 + M2292) |
| `is_bundle` | 0 semua | 1 untuk SKU bundle |
| `bundle_quota_manual` | 1 baris (10.932) | 0 baris |
| Stok bundle | angka statis manual di `stocks` | `MIN(floor(stok_komponen / multiplier))` |
| `/api/v2/assembly/boms` | `count: 0` | `count: 1` |
| `/api/v1/inventory/{bundle}` | `available_stock: 0`, `components: []` | `available_stock: 10932`, 2 komponen |
| Gejala | phantom stock ±995 unit (overselling) | stok rakitan konsisten |

---

## 5. Kontrak API v2 — dua keluarga endpoint

### 5.1 Peta keluarga endpoint

| Prefix | Peran | Implementasi | Pemanggil | Bentuk respons |
|---|---|---|---|---|
| `/api/v1/*` | **Eksekusi** — hitung BOM, checkout atomik, transisi status, audit webhook | `apps/wms-stub/main.py` | storefront checkout, skrip uji, admin | `{code, msg, data}` |
| `/api/v2/*` | **Read-model** untuk storefront — master, saldo, BOM, gudang | `apps/wms-stub/compat.py` | `lib/erp/pull.mjs` (`npm run erp:sync`) | flat `{count, ...}` |
| `/api/webhooks/wms` | **Receiver** event keluar ERP | `app/api/webhooks/wms/route.ts` (webstore) | `post_webhook()` di ERP | `{ok, ...}` |
| `/v1/open/*` | Panel admin legacy (ringkasan, list order, event, kuota) | `apps/wms-stub/main.py` | `osr-admin` :3001 | `{code, msg, data}` |

**Aturan pemisahan:** `/api/v1/*` mengubah state (kecuali dua endpoint baca: `inventory/{sku}` dan `audit/webhook-logs`). `/api/v2/*` **tidak pernah** mengubah state — murni SELECT dari SQLite yang sama.

### 5.2 Aturan umum dan envelope

- Base URL lokal: `http://127.0.0.1:8100`.
- Content-Type: `application/json`.
- **`/api/v1/*` memakai envelope:** `{"code":200,"msg":{"id":"Sukses","en":"Success"},"data":{...}}`.
- **`/api/v2/*` tidak memakai envelope:** respons langsung `{"count":N,"products":[...]}`.
- Error dari kedua keluarga memakai format bawaan FastAPI: `{"detail":"..."}` dengan status 4xx/5xx. **Tidak** dibungkus envelope — pemanggil wajib memeriksa HTTP status, bukan hanya `code`.
- **Pengecualian yang harus diingat:** `POST /api/v1/storefront/checkout` mengembalikan objek **tanpa** envelope (`message`, `order_ref`, `status`, `updated_by`, `sla_seconds`). Ini sengaja (respons ringkas untuk storefront), tetapi berarti satu endpoint di keluarga v1 tidak mengikuti pola `code/msg/data`.

### 5.3 `/api/v1/*` — engine eksekusi

#### (a) `GET /api/v1/inventory/{sku}` — stok hasil kalkulasi BOM

- Non-bundle: stok fisik (`SUM(stocks.available)`).
- Bundle: `MIN(floor(stok_komponen / multiplier))` untuk setiap komponen di `sku_bom`.
- Baseline: bundle tidak punya BOM → `available_stock: 0`, `components: []` (bukan angka karangan).
- `404` bila SKU tidak ada.

```bash
curl -s http://127.0.0.1:8100/api/v1/inventory/Sanctum+Noctis-20ml-A1
```

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

#### (b) `POST /api/v1/storefront/checkout` — potong stok atomik + Zero-Click

Request:

```json
{"order_ref":"ORD-2026-0001","channel":"WEBSTORE",
 "items":[{"sku":"M2291","qty":2}]}
```

Perilaku (dalam satu transaksi `BEGIN IMMEDIATE`):

1. Validasi SKU; `404` kalau tidak ada.
2. Bundle → potong **komponen** (`qty × multiplier`); bundle tanpa BOM → `409 bundle <sku> tanpa relasi BOM (baseline)`.
3. Non-bundle → potong stok SKU itu sendiri.
4. Insert `orders` (status `paid`, `paid_at`/`processing_at` = now) + `order_items`.
5. **Zero-Click:** status langsung `process` dengan `actor_last='SYSTEM'` + `order_status_history` (`source=CHECKOUT`), SLA 5 detik.
6. Commit, lalu webhook `order.status_changed` dikirim sebagai background task.

```json
{"message":"Pesanan terbayar dan otomatis diproses ke gudang (Zero-Click).",
 "order_ref":"ORD-2026-0001","status":"process","updated_by":"SYSTEM","sla_seconds":5.0}
```

Catatan: respons **tidak** memakai envelope dan **tidak** mengembalikan `order_id` internal — pakai `order_ref` sebagai kunci untuk semua langkah berikutnya.

#### (c) `POST /api/v1/wms/orders/{order_ref}/transition` — state machine

Query: `target_status` (wajib), `tracking_number` (opsional).

Alur baku: `paid → process → pick → packing → packed → ready_to_pickup → sent → completed`.
Terminal: `cancelled`, `returned`, `completed`.

Aturan yang ditegakkan:

| Kondisi | HTTP | Body |
|---|---|---|
| Status tidak dikenal (mis. `on_process`) | `422` | `{"detail":"enum status tidak dikenal"}` |
| Order tidak ada | `404` | `{"detail":"order tidak ditemukan"}` |
| Order sudah terminal | `409` | `{"detail":"order terminal — immutable"}` |
| Status mundur (mis. `packed → paid`) | `409` | `{"detail":"no-regression: status tidak boleh mundur"}` |

Respons sukses:

```json
{"code":200,"msg":{"id":"Sukses","en":"Success"},"data":{
  "order_ref":"ORD-2026-0001","from":"process","to":"packed",
  "updated_by":"SYSTEM","webhook_sent":true,"webhook_status":null}}
```

`webhook_status` bernilai `null` karena pengiriman dilakukan sebagai background task; status HTTP sebenarnya ada di `GET /api/v1/audit/webhook-logs`. `updated_by` = `COURIER` untuk `sent`/`completed`, `SYSTEM` untuk status lainnya.

#### (d) `GET /api/v1/audit/webhook-logs?limit=100` — bukti pengiriman + signature

```json
{"code":200,"msg":{"id":"Sukses","en":"Success"},"data":[
 {"id":1,"event_id":"evt_wms_status_20261028_100221_941",
  "event":"order.status_changed","lane":"4.2","attempt":1,
  "http_status":202,"signature":"sha256=5afbb0e74167…",
  "sent_at":"2026-10-28 02:02:21"}]}
```

Tabel sumber: `webhook_delivery_log` (`event_id, event, lane, attempt, http_status, signature, sent_at`). Ini bukti audit yang dipakai di bab hasil paper: jumlah event, status HTTP, dan tanda tangan HMAC.

### 5.4 `/api/v2/*` — read-model untuk storefront

Seluruh endpoint memakai SQLite yang sama dengan engine. Hasil verifikasi 28 Okt 10:05 WIB (mode `tobe`):

| Endpoint | Field penting | `count` terverifikasi |
|---|---|---|
| `GET /api/v2/master/products?limit=5000` | `id, sku, name, brand, category, item_type, specs, stock, unit_price, is_assembly` | **3.696** |
| `GET /api/v2/inventory/balances?limit=5000` | `sku, stock_on_hand, allocated, available, on_order, bin_code` | **3.664** |
| `GET /api/v2/inventory/by-warehouse` | `sku, warehouse_id, warehouse_name, available, reserved, on_order` | **7.325** baris stok |
| `GET /api/v2/assembly/boms` | `target_sku, version, source, labor_cost, overhead_cost, components[{component_sku, qty, unit_price, scrap_pct}]` | **1** (tobe) / **0** (baseline) |
| `GET /api/v2/assembly/bundle-stock` | `bundle_sku, quota_static, components[], stock_from_components, phantom` | **0** di tobe (kuota manual kosong) |
| `GET /api/v2/master/warehouses` | `id, code, name, type` | **3** |
| `GET /api/v2/master/operational` | `min_stock, max_stock, reorder_point` | **0** (belum disimpan ERP) |

Catatan kontrak:

- `products` memakai `id` = `sku` (webstore memetakan `id → sku`).
- `brand` diisi segmen gender (`MEN`/`WOMEN`/`UNISEX`) karena itu yang dipakai filter UI; `category` = `BUNDLING` / `EAU DE PARFUM`.
- 3.664 < 3.696 karena 32 SKU belum punya baris stok — **bukan bug**; webstore menampilkan stok 0 apa adanya.
- `assembly/bundle-stock` **kosong di mode tobe** karena tabel `bundle_quota_manual` memang tidak diisi. Angka phantom hanya ada di baseline; ini konsisten dengan seeder (`bundle_quota_manual` = 1 baris hanya di baseline).
- `operational` sengaja kosong: ERP belum menyimpan parameter itu. Endpoint mengembalikan `count: 0`, bukan angka karangan.
- `boms.source` = `PERPACK_API`, `version` = `BOM-v2`, `labor_cost`/`overhead_cost` = 0 (ERP belum memodelkan biaya tenaga kerja).
- Semua endpoint `/api/v2/*` menerima `limit` (products/balances: 1–50.000).

### 5.5 Siapa memanggil apa

```
lib/erp/pull.mjs   ->  GET /api/v2/master/products
                   ->  GET /api/v2/inventory/balances
                   ->  GET /api/v2/assembly/boms
                   ->  GET /api/v2/master/warehouses
                   ->  GET /api/v2/master/operational

storefront checkout -> POST /api/v1/storefront/checkout
skrip uji / admin   -> POST /api/v1/wms/orders/{ref}/transition
                    -> GET  /api/v1/inventory/{sku}
                    -> GET  /api/v1/audit/webhook-logs
osr-admin :3001     -> GET  /v1/open/admin/summary, /v1/open/sales-order/list,
                             /v1/open/admin/webhook-events, /v1/open/admin/bundles
```

`POST /v1/open/catalog/push` masih ada sebagai stub kompatibilitas; di v2 katalog **tidak** di-push, tetapi ditarik storefront lewat `/api/v2/*`. Responsnya: `{"note":"v2: katalog disajikan via GET /api/v1/inventory/{sku}","sent":true}`.

### 5.6 Autentikasi

| Keluarga | Token | Perilaku terverifikasi |
|---|---|---|
| `/api/v2/*` | `OSR_ERP_SERVICE_TOKEN` (ERP) ↔ `OSR_ERP_TOKEN` (webstore) | Kalau ERP tidak menyetel token, request tanpa header tetap `200`. Kalau disetel, wajib `Authorization: Bearer <token>` yang sama; selain itu `401 Token service ERP tidak valid` |
| `/api/v1/*` | tidak ada token (loopback saja) | jangan diekspos ke jaringan publik |
| `/api/webhooks/wms` | `OSR_WEBHOOK_TOKEN` webstore ↔ `WEBHOOK_TOKEN` ERP | `202` diterima, `401` token/signature salah |

> Uji 28 Okt: `curl -H "Authorization: Bearer wrong" /api/v2/master/products?limit=1` → `200`, karena `OSR_ERP_SERVICE_TOKEN` tidak disetel di server. Jangan menyimpulkan "token jalan" dari hasil ini — setel token di kedua sisi lalu uji ulang.

### 5.7 Uji cepat seluruh kontrak

```bash
# v1 — eksekusi
curl -s http://127.0.0.1:8100/healthz; echo
curl -s http://127.0.0.1:8100/api/v1/inventory/Sanctum+Noctis-20ml-A1; echo
curl -s "http://127.0.0.1:8100/api/v1/audit/webhook-logs?limit=3"; echo

# v2 — read-model (count harus 3696 / 3664 / 1 / 3 / 0)
for p in "master/products?limit=5000" "inventory/balances?limit=5000" \
         "assembly/boms" "master/warehouses" "master/operational"; do
  printf "%-32s " "$p"
  curl -s "http://127.0.0.1:8100/api/v2/$p" \
    | python3 -c "import sys,json;print(json.load(sys.stdin).get('count'))"
done
```

Keluaran nyata 28 Okt 10:05 WIB:

```
master/products?limit=5000       3696
inventory/balances?limit=5000    3664
assembly/boms                    1
master/warehouses                3
master/operational               0
```

---

## 6. Menarik data ke webstore (sync)

```bash
cd ~/BPI-Simulation-Webstore
npm run erp:sync
```

Keluaran nyata (28 Okt, mode `tobe`):

```
✓ selesai dalam 1065 ms
  snapshot : .data/erp/catalog.snapshot.json
  manifest : .data/erp/manifest.json
  checksum : f9f5c05c651d0e52…
  counts   : 3.696 produk · 3.664 saldo · 1 BOM · 3 gudang
  Δ data berubah sejak sync sebelumnya:
    boms: 0 → 1
  ✓ integritas referensial bersih
```

Yang dilakukan `scripts/erp-sync.mjs`:

1. Tarik lima endpoint `/api/v2/*` berurutan (retry + timeout via `OSR_ERP_RETRIES` / `OSR_ERP_TIMEOUT_MS`).
2. Hitung **integritas**: SKU duplikat, BOM yatim, harga kosong, stok negatif, breakdown gudang.
3. Tulis `catalog.snapshot.json` (payload + integrity + checksum sha256) dan `manifest.json` (ringkasan + delta).
4. Bandingkan checksum dengan snapshot lama → cetak `Δ`.

Artefak:

```
.data/erp/
  catalog.snapshot.json   payload penuh + checksum   (di-commit, bisa diaudit)
  manifest.json           ringkasan tanpa payload    (di-commit)
  *.moai.bak.json         arsip snapshot ERP lama    (jangan dipakai)
```

Setelah sync, restart proses webstore atau biarkan reload otomatis saat `mtime` snapshot berubah (`lib/erp/snapshot.ts`).

---

## 7. Menjalankan webstore & verifikasi

```bash
cd ~/BPI-Simulation-Webstore
npm run dev       # http://127.0.0.1:3000
```

Variabel penting di `.env.local`:

```
OSR_ERP_BASE_URL=http://127.0.0.1:8100
OSR_ERP_TOKEN=            # kosongkan kalau ERP tidak memakai service token
OSR_CATALOG_SOURCE=snapshot
OSR_WEBHOOK_TOKEN=...     # wajib sama dengan WEBHOOK_TOKEN di ERP
OSR_WEBHOOK_HMAC_SECRET=... # wajib sama dengan WEBHOOK_SECRET di ERP
```

Verifikasi:

```bash
curl -s "http://127.0.0.1:3000/api/catalog/products?perPage=2"
# → items[0]: sku Sanctum+Noctis-20ml-A1, isBundle true,
#   priceIdr 178000 (89.000 + 89.000 dari komponen), collection "bundle"
```

Yang harus terlihat kalau berhasil:

- `/` dan `/shop` menampilkan SKU dari ERP (`M####`), bukan katalog hardcoded.
- SKU bundle menampilkan harga **hasil hitung komponen**, bukan harga simpanan.
- `/admin/simulasi` menampilkan base URL, waktu snapshot, checksum, jumlah record, status integritas.
- Mode `tobe` → stok bundle bergerak saat komponen terjual. Mode `baseline` → angka diam (cacat yang direproduksi).

---

## 8. Jalur B — order, status, dan webhook keluar

### 8.1 Urutan pemanggilan

```
storefront  --POST /api/v1/storefront/checkout-->  ERP  (paid -> process, Zero-Click)
ERP         --POST /api/webhooks/wms (HMAC)----->  webstore core (order.status_changed)
admin/uji   --POST /api/v1/wms/orders/{ref}/transition--> ERP (packed, sent, ...)
ERP         --POST /api/webhooks/wms (HMAC)----->  webstore core (status berikutnya)
```

### 8.2 Kontrak receiver: `POST /api/webhooks/wms`

| Item | Nilai |
|---|---|
| Auth | `Authorization: Bearer <OSR_WEBHOOK_TOKEN>` |
| Alternatif auth | `X-OSR-Webhook-Token: <token>` atau `?token=` |
| Signature | `X-Perpack-Signature: sha256=<hmac_sha256(raw_body, secret)>` (nama kontrak v2) |
| Alias signature | `X-OSR-Signature: sha256=<...>` (yang dibaca receiver `lib/webhooks.ts`) |
| Dedupe | `event_id` → fallback `Idempotency-Key` (header ini diisi ERP = `event_id`) → fallback hash body |
| Idempotensi | kunci `evt:<event>:<event_id>` dan `idem:<event_id>` |

Status code: `202` diterima · `200` duplikat · `400` body invalid/kosong (`EMPTY_BODY`) · `401` token/signature salah (`UNAUTHORIZED`) · `422` tanpa field `event` · `503` token server belum diset.

Event yang punya efek di core:

| Event | Efek |
|---|---|
| `stock.updated` / `inventory.updated` | menambah "terjual" komponen → stok bundle turun (hanya mode tobe) |
| `order.status_changed` / `order.updated` | memperbarui status + tracking order yang dikenal core |
| `ping` / `health.check` | di-ack, tanpa efek |

Event lain (mis. `catalog.updated`, `shipment.updated`) dicatat lalu di-ack.

### 8.3 Payload status yang dikirim ERP

```json
{"event_id":"evt_wms_status_20261028_100221_941",
 "event":"order.status_changed",
 "timestamp":"2026-10-28T02:02:21Z",
 "data":{"order_ref":"DOCV2-TEST-001","wms_order_id":null,"channel":"WEBSTORE",
         "previous_status":"paid","current_status":"process",
         "ref":"DOCV2-TEST-001","status":"PROCESSING",
         "tracking_no":null,"actor":"SYSTEM",
         "courier":{"name":null,"service":null,"tracking_number":null},
         "updated_by":"SYSTEM"}}
```

Ada **dua field status** dengan semantik berbeda dan keduanya wajib ada:

- `previous_status` / `current_status` = enum internal ERP (`paid`, `process`, `pick`, `packing`, `packed`, `ready_to_pickup`, `sent`, `completed`, `cancelled`, `returned`).
- `status` = enum baku receiver (`PAID, PROCESSING, PICKING, PACKED, HANDOVER_TO_COURIER, IN_TRANSIT, ARRIVED_AT_HUB, OUT_FOR_DELIVERY, DELIVERED, COMPLETED`, plus warisan baseline `SENT`, `on_process`).

Pemetaan enum (`STATUS_ENUM_MAP` di ERP):

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

> `on_process` adalah enum **tidak baku** dari data produksi dan ditolak mapper (`UNKNOWN_ENUM`). Itu cacat yang direproduksi seeder, bukan sesuatu yang perlu "diperbaiki" di receiver.

### 8.4 Hasil uji end-to-end 28 Okt 10:02 WIB

```
POST /api/webhooks/wms  {"event":"ping"}                    -> 202
POST /api/v1/storefront/checkout  {M2291 x2}                -> 200
  {"message":"... Zero-Click.","status":"process",
   "updated_by":"SYSTEM","sla_seconds":5.0}
POST /api/v1/wms/orders/<ref>/transition?target_status=packed -> 200
  {"from":"process","to":"packed","webhook_sent":true,"webhook_status":null}
GET  /api/v1/audit/webhook-logs?limit=3                     -> 200
  {"event":"order.status_changed","lane":"4.2","http_status":202,
   "signature":"sha256=5afbb0e74167…"}
GET  /api/webhooks/wms?limit=3  (receiver)                  -> 200
  counters: received 6, accepted 4, duplicates 2, rejected 0, applied 2
  event diterima dengan status "PROCESSING" (dipetakan dari process)
```

Uji negatif yang juga lulus:

```
POST transition?target_status=paid      -> 409 {"detail":"no-regression: status tidak boleh mundur"}
POST transition?target_status=on_process-> 422 {"detail":"enum status tidak dikenal"}
```

**Catatan traceability (penting untuk bab hasil):** receiver mencatat `apply_note: "order <ref> tidak dikenal di core (diabaikan)"` ketika `order_ref` dibuat langsung di ERP, bukan lewat checkout webstore. Artinya event tetap **diterima, ditandatangani, dan tersimpan**, tetapi state UI tidak berubah. Untuk demo DMAIC, order uji harus dibuat lewat checkout webstore supaya rantai bukti utuh dari klik pelanggan sampai status akhir.

---

## 9. Pemetaan field ERP → `Product` storefront

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
| `priceIdr` bundle | Σ(`unit_price` × `qty`) + `labor_cost` + `overhead_cost` | dihitung, bukan disimpan |

Tidak ada fallback yang mengarang: field kosong tampil kosong.

---

## 10. Troubleshooting

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| `sqlite3.OperationalError: no such table: bundle_components` | kode v1 (`main.py` root) di atas skema v2 (`sku_bom`) | jalankan `uvicorn apps.wms-stub.main:app` |
| `/api/v2/assembly/boms` → `count: 0` padahal `OSR_MODE=tobe` | database masih hasil seed baseline | `OSR_MODE=tobe python db/seed.py`, sync ulang |
| `is_bundle:false` di semua SKU | idem | idem |
| `/healthz` bilang `mode:baseline` tetapi BOM ada isinya | dua proses ERP menumpuk; proses lama (baseline) yang memegang port 8100 | `ss -ltnp \| grep 8100`, matikan PID lama, start ulang dengan env yang benar |
| `checkout` → `409 bundle ... tanpa relasi BOM (baseline)` | SKU bundle di DB baseline (BOM 0 baris) | seed `tobe`; kalau memang menguji baseline, ini perilaku yang diharapkan |
| `transition` → `422 enum status tidak dikenal` | memakai enum receiver (`IN_TRANSIT`, `on_process`) di endpoint ERP | pakai enum internal ERP (`sent`, `process`, …) |
| `transition` → `409 no-regression` | mencoba memundurkan status | urutan baku hanya maju; koreksi lewat `cancelled`/`returned` |
| `webhook_sent:true` tetapi UI tidak berubah | `order_ref` tidak dikenal core (dibuat di ERP langsung) | buat order lewat checkout webstore |
| `webhook_sent:true`, `webhook_status:null` | pengiriman background task | cek hasil sebenarnya di `/api/v1/audit/webhook-logs` |
| Webhook `401` | `WEBHOOK_SECRET` ERP ≠ `OSR_WEBHOOK_HMAC_SECRET` receiver, atau `WEBHOOK_TOKEN` ≠ `OSR_WEBHOOK_TOKEN` | samakan, restart keduanya |
| `erp:sync` gagal connect | ERP belum jalan / port salah | `curl :8100/healthz`, cek `OSR_ERP_BASE_URL` |
| `401` saat sync | ERP menyetel `OSR_ERP_SERVICE_TOKEN` tapi token webstore beda | samakan token kedua sisi |
| `Δ counts` tidak berubah setelah reseed | snapshot lama di-cache memori proses | restart `npm run dev` |
| Harga bundle 0 / "komposisi tidak tersedia" | BOM yatim / komponen tidak ada di master | lengkapi BOM, cek `integrity` di `manifest.json` |
| `expected object, got array` saat parse `/api/v1/*` | lupa unwrap `data` | keluarga v1 dibungkus `code/msg/data`; v2 tidak |

---

## 11. Checklist go-live simulasi

- [ ] `db/wms.db` di-seed dengan mode yang benar (`baseline` untuk before, `tobe` untuk after)
- [ ] `curl :8100/healthz` → `ok:true`, `mode` sesuai **dan** cocok dengan isi DB (`sku_bom`)
- [ ] `/api/v1/inventory/{bundle}` → `available_stock` terhitung (tobe) / `0` (baseline)
- [ ] 5 endpoint `/api/v2/*` merespons; `count` = 3.696 / 3.664 / 1 / 3 / 0
- [ ] `npm run erp:sync` → integritas bersih, checksum tercatat
- [ ] `/api/catalog/products` menampilkan SKU ERP + harga rakitan hasil hitung
- [ ] `POST /api/v1/storefront/checkout` → `status:process`, `updated_by:SYSTEM`
- [ ] `POST /api/v1/wms/orders/{ref}/transition?target_status=packed` → `webhook_sent:true`
- [ ] `GET /api/v1/audit/webhook-logs` → `http_status:202` + signature tercatat
- [ ] Receiver: counters `accepted` naik, status terpetakan (`PROCESSING`, bukan `process`)
- [ ] Uji negatif: `409 no-regression`, `422 enum`, `401` webhook dengan secret salah
- [ ] checksum + counts + counters dicatat di log eksperimen (bukti reproducibility)

---

## 12. Berkas yang terlibat

**ERP** (`~/bpi-simulation-erp`)

```
apps/wms-stub/main.py           engine v2: /api/v1/* (checkout, transition, inventory, audit),
                                webhook keluar HMAC, panel admin /v1/open/*
apps/wms-stub/compat.py         read-model /api/v2/* untuk storefront
db/schema.sql                   skema SQLite (variants, sku_bom, stocks, orders, ...)
db/seed.py                      seeder per mode (baseline | tobe)
scenario/reproduce_baseline.py  verifikasi angka baseline
```

**Webstore** (`~/BPI-Simulation-Webstore`)

```
lib/erp/pull.mjs         puller HTTP /api/v2/* (retry, timeout, integrity, checksum)
lib/erp/snapshot.ts      cache + reload saat mtime berubah
lib/erp/mapper.ts        ERP -> Product[]
lib/webhooks.ts          receiver: auth, HMAC, dedupe, mapper enum
app/api/webhooks/wms/    route GET (probe/counter) + POST (event masuk)
scripts/erp-sync.mjs     CLI npm run erp:sync
docs/                    dokumen integrasi (katalog, webhook, panduan ini)
```

---

## 13. Changelog

**v2.0 — 28 Okt 2026**

- Bab kontrak ditulis ulang total menjadi §5 dengan pemisahan eksplisit `/api/v1/*` (eksekusi) vs `/api/v2/*` (read-model).
- Ditambahkan 7 endpoint `/api/v2/*` (v1.1 hanya 5) termasuk `inventory/by-warehouse` dan `assembly/bundle-stock`.
- Ditambahkan detail 4 endpoint `/api/v1/*` beserta kode error `404/409/422` yang terverifikasi.
- Didokumentasikan perbedaan envelope (`code/msg/data` vs flat) dan pengecualian `storefront/checkout`.
- Jalur B diperluas: bukan hanya webhook receiver, tetapi urutan checkout → transition → webhook, plus tabel pemetaan enum.
- Ditambahkan catatan traceability `order ... tidak dikenal di core (diabaikan)`.
- Troubleshooting ditambah 5 baris (mode/DB mismatch, port ganda, enum tertukar, unwrap `data`, 401 webhook).
- Semua angka dan keluaran curl diperbarui dari eksekusi 28 Okt 2026 10:00–10:06 WIB.

**v1.1 — 28 Okt 2026**

- Menggantikan `INTEGRASI_ERP_CATALOG.md` v1.0 yang masih mengarah ke MOAI SCM-ERP (`scm-erp-pied.vercel.app`).

---

*Dokumen ini menggantikan `INTEGRASI_ERP_CATALOG.md` v1.0 (MOAI SCM-ERP) dan `PANDUAN_KONEKSI_ERP_WEBSTORE.md` v1.1. Sumber data: engine ERP simulasi lokal `apps/wms-stub`, bukan MOAI.*