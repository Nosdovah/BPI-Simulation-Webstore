# Kontrak API ERP → Storefront (resmi)

**Status:** AKTIF · **Kontrak:** replika API Perpack · **Diverifikasi:** 29 Oktober 2026
**Pengganti:** `docs/arsip/KONTRAK_API_ERP_ACUAN_RESMI.md` (blueprint-v2 — **gugur**)

---

## 0. Keputusan yang mengikat

| Hal | Keputusan |
|---|---|
| Kontrak resmi | **Replika Perpack** (1:1 dengan API Perpack Octarine) |
| Skema blueprint-v2 (`/api/v2/*`) | **DITINGGALKAN.** Tidak boleh dipakai, tidak boleh di-deploy |
| `compat.py` | Dihapus dari jalur main |
| Tabel `variants` / `stocks` / `sku_bom` / `bundle_quota_manual` | Tidak dipakai lagi |
| Skema `main` + Railway | Memegang skema Perpack: `product_variants`, `variant_stocks`, `variant_components`, `orders` (40 field) |
| Kalau ada mismatch nama/format | **Yang diubah storefront**, bukan ERP |

> Men-deploy skema v2 ke `main`/Railway = menimpa dan merusak replika. Branch
> `feat/api-v1-v2-contract`, `feat/erp-bundle-stock`, `feat/v2-deploy-gate`
> harus di-**repoint** ke endpoint di §2, bukan di-merge ke `main`.

---

## 1. Base URL, auth, swagger

- **Base:** `https://web-production-e60b55.up.railway.app`
- **Auth:** tidak dipakai — open, tanpa token/key. **CORS `*`**
- **Swagger UI:** `/docs` · **OpenAPI JSON:** `/openapi.json` ← **sumber kanonik**
  (12 path. Jangan reverse-engineer dari bundle JS.)

---

## 2. Endpoint resmi

### 2.1 Webhook bridge (dipakai storefront)

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/api/webhooks/catalog?page=&length=` | Tarik master-data produk (flat) |
| `POST` | `/api/webhooks/purchase-order` | Terima PO dari storefront → order masuk, status `paid` |
| `POST` | `/api/webhooks/wms` | Event `order.status_changed` · `stock.updated` (mengubah DB) |
| `GET` | `/api/webhooks/wms?limit=` | Riwayat webhook (audit) |

### 2.2 Replika API Perpack (1:1)

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/v1/channels` | Daftar channel (13 = `WEBSTORE`) |
| `GET` | `/v1/warehouses` | Daftar gudang |
| `GET` | `/v1/products/group/page` | Grup produk + varian nested (stok per gudang) |
| `GET` | `/v1/products/list` | Varian flat |
| `POST` | `/v1/orders/page` | Sales order (40 field), body `{page,length,channel_id?,status?,search?}` |

### 2.3 TO-BE (BOM / simulasi)

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/api/to-be/bundle-stock?sku=&limit=` | `stock_to_be = MIN(⌊stok/multiplier⌋)` + `phantom`, AS-IS vs TO-BE |
| `GET` | `/api/to-be/sales-summary` | KPI Sales Order / Sales Product |

---

## 3. Envelope

Semua endpoint memakai bentuk yang sama:

```json
{ "code": 200, "msg": { "id": "Sukses", "en": "Success" }, "data": ..., "metadata": {...} }
```

`code != 200` = gagal. `metadata` berisi `{page, length, count, total_page}`.

---

## 4. Field asli ERP (koreksi 5-field)

| Kebutuhan storefront | Field ERP | Catatan |
|---|---|---|
| `sku` | `sku` (produk) · `reference_no` (order) | Regex **mengizinkan `+`** — bundle asli: `Serenity+Solace-100ml-A2`. Bundle ditandai `is_bundle: true`, **bukan** suffix `-BTL`/`-BUNDLE` |
| `price_idr` | `sell_price` (produk) / `amount` (order) | Integer Rupiah penuh ✓ |
| `stock_available` | `stock_available` (katalog, SUM) · `stocks[].available` (per gudang) | Untuk bundle, angka **benar** ada di `stock_to_be` (`/api/to-be/bundle-stock`) — ERP sudah menghitung MIN() |
| `order_status` | `status` | Huruf kecil. Enum sah: `paid`·`process`·`picking`·`packing`·`packed`·`ready_to_pickup`·`sent`·`completed`·`cancelled`·`returned` |
| `event_timestamp` | `order_at` / `created_at` / `updated_at` | **Sudah RFC3339 UTC `Z`** (lihat §7) |

---

## 5. Bentuk data

### 5.1 Katalog — `GET /api/webhooks/catalog`

12 field per baris: `id, product_group_id, name, sku, sku_code, alias, sell_price,
purchase_price, is_bundle, components, images, stock_available`

`components[]` = `{product_id, component_sku, multiplier_qty}` — **`multiplier_qty`**, bukan `qty`.

### 5.2 Order — `POST /v1/orders/page` (40 field)

```
id, reference_no, order_at, created_at, process_at, returned_at, deadline_at,
qty, amount, cogs, shipping_fee, cod_fee, courier, courier_label,
warehouse_name, channel_name, channel_image, customer_username, customer_name,
customer_phone, customer_email, picklist_id, picklist_no, delivery_note_id,
delivery_note_no, awb, is_shipping_label_printed, printed, product_summary,
integration_id, integration_store, is_cod, is_pre_order, is_instant,
is_booking, is_fake_order, status, status_mp, sent_at, updated_at
```

**Kunci order = `reference_no`**, bukan `id`.

### 5.3 Varian + stok per gudang — `GET /v1/products/group/page`

`variants[]` = `{sku, product_group_id, variation_label, variation_value, weight,
type, is_bundle, stocks[]}`

`stocks[]` = `{warehouse_id, warehouse_name, available, reserved, on_order}`

---

## 6. Jebakan kontrak yang sudah diverifikasi

### 6.1 Paginasi — server memotong `length` secara diam-diam

| Endpoint | `length` maksimum efektif |
|---|---|
| `/api/webhooks/catalog` | **500** |
| `/v1/products/group/page` | **250** |
| `/api/to-be/bundle-stock` | 5.000 |

Kalau minta lebih, `metadata.length` ikut terpotong dan `total_page` menyesatkan.
**Jumlah katalog asli = 3.727 varian** (`metadata.count`), **bukan 3.711** — angka
3.711 muncul kalau paginasi berhenti sebelum halaman terakhir. Gate `erp:sync`
membandingkan `metadata.count` vs baris yang benar-benar diterima dan gagal kalau beda.

### 6.2 `/api/to-be/bundle-stock` punya DUA bentuk respons

| Parameter | `data` berisi |
|---|---|
| `?limit=N` | `{summary, bundles: [...]}` |
| `?sku=<sku>` | **satu objek bundle langsung** — `{sku, is_bundle, stock_as_is, stock_to_be, phantom, components[]}` |

`?sku=` **tidak** mengembalikan `{bundles: []}`. Kode yang memakai `data.bundles`
untuk kasus `sku` akan selalu dapat kosong — bug senyap. Normalisasi ada di
`normalizeBundleStock()` (`lib/erp/pull.mjs`).

### 6.3 Idempotensi order

`reference_no` adalah kunci tunggal. POST ulang dengan ref sama → `applied: false`
+ `order_id` lama. **Itu sukses idempoten, bukan kegagalan.**

### 6.4 `/v1/orders/page` tidak punya "GET by ref"

Filter hanya lewat `search` di body POST, dan `search` bisa cocok sebagian.
Hasil **wajib** disaring `reference_no === ref` supaya tidak salah order.

---

## 7. Timestamp

Live sudah **RFC3339 UTC `Z`**: `order_at: "2026-10-29T14:57:03Z"`, cocok dengan jam
UTC sebenarnya (diverifikasi 29 Okt 2026 15:34 UTC). Tidak ada offset yang perlu
ditebak.

Jaring pengaman: baris lama berbentuk `YYYY-MM-DD HH:MM:SS` diperlakukan sebagai
**Asia/Jakarta (+07:00)** — lihat `parseErpTimestamp()`.

---

## 8. Pemetaan status

Enum ERP (huruf kecil, 10 nilai) dipetakan ke enum storefront (huruf besar, nama sama):

```
paid → PAID · process → PROCESS · picking → PICKING · packing → PACKING
packed → PACKED · ready_to_pickup → READY_TO_PICKUP · sent → SENT
completed → COMPLETED · cancelled → CANCELLED · returned → RETURNED
```

Tidak ada penerjemahan semantik. Status lama (`PROCESSING`, `IN_TRANSIT`,
`DELIVERED`, `HANDOVER_TO_COURIER`, dll.) **dihapus** dari storefront.

---

## 9. Arah integrasi

```
                 ┌──────────────────────────────┐
                 │  ERP (replika Perpack)       │
                 │  Railway · open · CORS *     │
                 └──────┬───────────────┬───────┘
     Jalur A (baca)     │               │     Jalur B (tulis)
  catalog + stok + BOM  │               │  purchase-order + status + stok
                        ▼               ▼
                 ┌──────────────────────────────┐
                 │  Webstore (Next.js)          │
                 │  snapshot + overlay          │
                 └──────────────────────────────┘
```

- **Jalur A** — storefront **menarik** (`pull`) katalog + stok + BOM. Tidak ada push dari ERP.
- **Jalur B** — checkout **mendorong** (`push`) order ke ERP, lalu membaca balik status.

---

## 10. Bukti verifikasi

```
npm run verify:contract     → 24/24 lulus
npm run verify:integration  → 21/21 lulus
```

Cakupan `verify:integration`: katalog 3.727 · order dibuat (`order_id` nyata) ·
status awal `paid` · amount = qty × `sell_price` · retry idempoten (`applied:false`,
`order_id` sama) · baca balik via `/v1/orders/page` · `status_changed` → `process` ·
`stock.updated` → `effect.sisa_stok_total` · `stock_to_be = MIN(⌊stok/multiplier⌋)` ·
`phantom = stock_as_is − stock_to_be` · riwayat webhook tercatat.

---

## 11. Temuan integritas master data (dari `erp:sync`)

Bukan bug storefront — ini kondisi data ERP, dicatat sebagai input DMAIC:

- **15 SKU duplikat** (contoh: `M766-AquacDigi-20ml-A2`, `M1050-Veroz-20ml-A3`)
- **2 bundle tanpa komponen** (`M990-PinkyChiffony-20ml-A3`, `M992-PinkyChiffony-50ml-A3`)
- **3 bundle merujuk komponen yang tidak ada di master** (`M927-GamuciGardenia-30ml-A1`)
- **13 SKU tanpa harga jual** (contoh: `ZF30M`, `M1878`, `OCT-TEST-SMOKE-00x`)
- **TO-BE 3.039 bundle:** oversell **1** · understate **916** · matched **2.122**

---

## 12. Referensi lain

- `docs/API_INTEGRATION.md` di repo ERP (endpoint + payload + contoh kode frontend)
- `docs/INTEGRASI_WEBHOOK_ERP.md` (kontrak webhook masuk ke storefront)
- Arsip keputusan v2: `docs/arsip/`
