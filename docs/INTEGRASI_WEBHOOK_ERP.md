# Integrasi Webhook — ERP → osr-core

Dokumen ini menjelaskan kontrak endpoint yang dipakai ERP (WMS 4.1 / Order 4.2)
untuk mendorong event ke `osr-core` (repo webstore ini).

```
ERP / WMS  ──POST JSON──▶  osr-core  ──▶  state simulasi  ──▶  webstore UI
```

---

## 1. Endpoint

| Item | Nilai |
|---|---|
| Method | `POST` |
| Path | `/api/webhooks/wms` |
| Auth | `Authorization: Bearer <OSR_WEBHOOK_TOKEN>` |
| Alternatif auth | `X-OSR-Webhook-Token: <token>` atau `?token=<token>` |
| Content-Type | `application/json` |
| Signature (opsional) | `X-OSR-Signature: sha256=<hmac_sha256(raw_body, OSR_WEBHOOK_HMAC_SECRET)>` |

Signature hanya divalidasi kalau `OSR_WEBHOOK_HMAC_SECRET` diisi di server.
Selama kosong, token bearer sudah cukup.

### Status code

| Code | Arti |
|---|---|
| `202` | Diterima dan (bila ada handler) diterapkan |
| `200` | Duplikat — sudah pernah diterima, tidak diterapkan ulang |
| `400` | Body kosong / bukan JSON valid |
| `401` | Token atau signature salah |
| `422` | Field `event` tidak ada |
| `503` | `OSR_WEBHOOK_TOKEN` belum diset di server |

---

## 2. Bentuk payload

```json
{
  "event": "stock.updated",
  "event_id": "evt-20261027-0001",
  "occurred_at": 1793111666,
  "source": "wms-4.1",
  "data": {
    "materialCode": "M2292",
    "delta": 500
  }
}
```

- `event` **wajib**, string.
- `event_id` disarankan — dipakai untuk dedupe. Kalau tidak ada, dipakai
  header `Idempotency-Key`. Kalau keduanya tidak ada, dedupe memakai hash body.
- Event duplikat dijawab `200` tanpa efek samping.

---

## 3. Event yang didukung

### `stock.updated` / `inventory.updated`

Mendorong perubahan stok komponen. Efeknya: komponen bertambah "terjual",
sehingga stok bundle yang dihitung dari komposisi ikut turun **di mode to-be**.
Di mode baseline angka tetap (ini justru cacat yang direproduksi).

```json
{ "event": "stock.updated", "event_id": "s-001",
  "data": { "materialCode": "M2292", "delta": 500 } }
```

Field `data` yang diterima: `materialCode` | `material_code` | `sku` (wajib
berformat `M###`), lalu `delta` | `qty_sold` | `quantity_sold` | `quantity`.

### `order.status_changed` / `order.updated`

Memperbarui status order yang sudah dikenal core.

```json
{ "event": "order.status_changed", "event_id": "o-001",
  "data": { "ref": "ORD-WEBSTORE-PROD-261027-1001",
            "status": "IN_TRANSIT", "tracking_no": "SCP0000123",
            "actor": "SYSTEM" } }
```

`status` harus salah satu enum baku: `PAID`, `PROCESSING`, `PICKING`, `PACKED`,
`HANDOVER_TO_COURIER`, `IN_TRANSIT`, `ARRIVED_AT_HUB`, `OUT_FOR_DELIVERY`,
`DELIVERED`, `COMPLETED` (plus warisan baseline `SENT`, `on_process`).

### `ping` / `health.check`

Untuk uji koneksi. Dijawab `202` dengan `applied: true`.

### Event lain

`catalog.updated`, `shipment.updated`, dan event tak dikenal tetap dicatat
(`applied: false`) lalu di-ack `202`. Jadi ERP tidak akan retry terus-menerus.

---

## 4. Contoh pemanggilan

```bash
curl -X POST http://127.0.0.1:3000/api/webhooks/wms \
  -H "Authorization: Bearer $OSR_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-001" \
  -d '{"event":"stock.updated","data":{"materialCode":"M2292","delta":500}}'
```

Dengan signature HMAC (Node.js):

```js
const crypto = require("node:crypto");
const raw = JSON.stringify(payload);
const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-OSR-Signature": `sha256=${sig}`,
  },
  body: raw,
});
```

---

## 5. Membaca event yang masuk

```bash
curl -H "Authorization: Bearer $OSR_WEBHOOK_TOKEN" \
  "http://127.0.0.1:3000/api/webhooks/wms?limit=20"
```

Mengembalikan counter (`received`, `accepted`, `duplicates`, `rejected`,
`applied`) dan daftar event terakhir. Tanpa token, endpoint hanya menjawab
health probe (`token_configured`, fingerprint 4 karakter terakhir).

Event juga di-append ke `.data/webhook-events.jsonl` (best-effort, tidak
di-commit) supaya bisa diaudit setelah server restart.

---

## 6. Verifikasi efek

```bash
# dorong 500 unit M2292 terjual
curl -s -X POST http://127.0.0.1:3000/api/webhooks/wms \
  -H "Authorization: Bearer $OSR_WEBHOOK_TOKEN" -H "Content-Type: application/json" \
  -d '{"event":"stock.updated","data":{"materialCode":"M2292","delta":500}}'

# to-be  → stok bundle turun (10.932 → 10.432)
curl -s -H 'Cookie: osr_mode=tobe' \
  http://127.0.0.1:3000/api/catalog/products/SANCTUM-NOCTIS-20ML-A1

# baseline → angka tidak bergerak (10.932) = cacat overselling
curl -s -H 'Cookie: osr_mode=baseline' \
  http://127.0.0.1:3000/api/catalog/products/SANCTUM-NOCTIS-20ML-A1
```

Reset state: `POST /api/sim` dengan aksi reset, atau restart server.