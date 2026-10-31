import { resolveErpConfig, DEFAULT_BASE_URL, getJson, postJson, normalizeBundleStock, ERP_ENDPOINTS } from "./pull.mjs";

/**
 * Gateway order — satu-satunya tempat storefront MENULIS ke ERP (Jalur B/4.2).
 *
 * Kontrak resmi = replika Perpack. Jalur B memakai tiga endpoint:
 *
 *   POST /api/webhooks/purchase-order   checkout → order masuk DB (status awal `paid`)
 *   POST /v1/orders/page                baca balik sales order (40 field, kunci `reference_no`)
 *   POST /api/webhooks/wms              event `order.status_changed` / `stock.updated`
 *
 * `/api/v2/*` dan `/v1/open/*` SUDAH DITINGGALKAN — jangan dipakai lagi.
 *
 * File ini JavaScript murni supaya bisa dipakai langsung oleh
 * `scripts/verify-erp-integration.mjs` tanpa langkah build.
 */

export const ERP_ORDER_PATHS = {
  purchaseOrder: ERP_ENDPOINTS.purchaseOrder,
  ordersPage: ERP_ENDPOINTS.ordersPage,
  wmsEvents: ERP_ENDPOINTS.wmsEvents,
  groups: ERP_ENDPOINTS.groups,
  bundleStock: ERP_ENDPOINTS.bundleStock,
};

/** Channel WEBSTORE di ERP (dari `GET /v1/channels`). */
export const WEBSTORE_CHANNEL_ID = 13;

/** Idempotency key per order: `reference_no` ERP = `order.ref` storefront. */
export const CHANNEL_NAME = "WEBSTORE";

/**
 * Enum status ERP (huruf kecil, 10 nilai). Storefront memakai nama yang SAMA
 * dalam huruf besar — tidak ada penerjemahan semantik yang bisa drift.
 *
 *   paid · process · picking · packing · packed ·
 *   ready_to_pickup · sent · completed · cancelled · returned
 */
export const ERP_STATUSES = [
  "paid",
  "process",
  "picking",
  "packing",
  "packed",
  "ready_to_pickup",
  "sent",
  "completed",
  "cancelled",
  "returned",
];

/** Urutan maju yang sah (dipakai UI timeline & simulasi progres). */
export const ERP_FORWARD_FLOW = [
  "paid",
  "process",
  "picking",
  "packing",
  "packed",
  "ready_to_pickup",
  "sent",
  "completed",
];

/** Nama lama yang mungkin masih dikirim vendor/replika → enum resmi. */
const STATUS_ALIASES = {
  pending: "paid",
  processing: "process",
  pick: "picking",
  pack: "packing",
  ready: "ready_to_pickup",
  handover: "ready_to_pickup",
  shipped: "sent",
  in_transit: "sent",
  delivered: "completed",
  done: "completed",
  canceled: "cancelled",
  cancel: "cancelled",
  return: "returned",
};

/** Terima enum ERP apa pun (kecil/besar, snake/spasi) → enum resmi huruf kecil. */
export function normalizeErpStatus(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (ERP_STATUSES.includes(key)) return key;
  if (STATUS_ALIASES[key]) return STATUS_ALIASES[key];
  return null;
}

/** Enum ERP → enum storefront (UPPERCASE). Sumber kebenaran tetap ERP. */
export function mapErpStatus(raw) {
  const normalized = normalizeErpStatus(raw);
  return normalized ? normalized.toUpperCase() : null;
}

/** Urutan index status storefront (untuk cegah regresi). */
export const CANONICAL_STATUSES = ERP_STATUSES.map((s) => s.toUpperCase());

/**
 * Timestamp ERP.
 *
 * Kondisi live (diverifikasi 29 Okt 2026): ERP SUDAH mengirim RFC3339 UTC
 * berakhiran `Z` — `order_at: "2026-10-29T14:57:03Z"`, cocok dengan jam UTC
 * sebenarnya. Jadi tidak ada offset yang perlu ditebak.
 *
 * Cabang "tanpa zona" di bawah hanya jaring pengaman untuk baris lama /
 * impor manual yang masih berbentuk `YYYY-MM-DD HH:MM:SS`. Baris seperti itu
 * diperlakukan sebagai **Asia/Jakarta (+07:00)**, bukan UTC — supaya timeline
 * tidak meleset 7 jam.
 */
export function parseErpTimestamp(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Sudah punya zona waktu (Z atau ±HH:MM)
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }

  // "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DDTHH:MM:SS" tanpa zona → anggap WIB
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}+07:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function resolveErpOrderConfig(env = process.env) {
  const base = resolveErpConfig(env);
  const rawMode = String(env.OSR_ERP_ORDER_MODE ?? "push").trim().toLowerCase();
  const rawOverlay = String(env.OSR_ERP_STOCK_OVERLAY ?? "webhook").trim().toLowerCase();
  return {
    ...base,
    /** push = setiap order dikirim ke ERP; off = storefront berdiri sendiri */
    mode: rawMode === "off" ? "off" : "push",
    /** 1 = checkout gagal kalau ERP tidak bisa menerima order */
    strict: env.OSR_ERP_ORDER_STRICT === "1",
    /** 1 = status order di webstore ditarik ulang dari ERP saat dibaca */
    sync: env.OSR_ERP_ORDER_SYNC !== "0",
    /**
     * webhook (default) = stok dikurangi oleh event `stock.updated` ERP;
     * local = overlay "terjual" di storefront (dipakai kalau webhook dimatikan).
     */
    stockOverlay: rawOverlay === "local" ? "local" : "webhook",
    /** masa berlaku cache pembacaan status (ms) */
    statusTtlMs: Math.max(0, Number(env.OSR_ERP_STATUS_TTL_MS ?? 3000)),
    channelId: Number(env.OSR_ERP_CHANNEL_ID ?? WEBSTORE_CHANNEL_ID),
  };
}

/* --------------------------------------------------------------- push --- */

/**
 * Kirim order storefront ke ERP.
 *
 * `reference_no` dipakai sebagai identitas tunggal: kalau order dengan ref itu
 * sudah ada, ERP menjawab `applied:false` + `order_id` lama — itu SUKSES
 * idempoten, bukan kegagalan.
 */
export async function pushOrder(cfg, order) {
  const body = {
    reference_no: order.ref,
    channel: CHANNEL_NAME,
    customer_name: order.customer?.name ?? "",
    customer_phone: order.customer?.phone ?? "",
    customer_email: order.customer?.email ?? "",
    items: (order.items || []).map((i) => ({
      sku: i.sku,
      qty: i.qty,
      price: i.priceIdr,
    })),
  };

  try {
    const json = await postJson(cfg, ERP_ORDER_PATHS.purchaseOrder, body);
    const data = json.data ?? {};
    const rawStatus = data.status ?? "paid";

    /* ERP generasi baru ikut memotong stok saat purchase-order diterima
     * (`data.stock_deducted.deducted`). Kalau blok itu ada, ERP adalah pemilik
     * pengurangan stok untuk order ini — storefront harus berhenti mengirim
     * `stock.updated`, kalau tidak stok turun dua kali. ERP generasi lama tidak
     * mengirim blok ini (null), dan di situlah storefront tetap jadi pemilik. */
    const deductedRaw = data.stock_deducted?.deducted;
    const stockDeducted =
      deductedRaw && typeof deductedRaw === "object" && Object.keys(deductedRaw).length > 0
        ? Object.fromEntries(
            Object.entries(deductedRaw).map(([k, v]) => [
              k,
              Number(v) || 0,
            ]),
          )
        : null;

    return {
      ok: true,
      contract: "perpack-replica",
      httpStatus: 200,
      erpId: typeof data.order_id === "number" ? data.order_id : null,
      erpOrderRef: data.reference_no ?? order.ref,
      status: mapErpStatus(rawStatus) ?? "PAID",
      rawStatus,
      applied: data.applied !== false,
      productSummary: data.product_summary ?? null,
      stockDeducted,
      note:
        data.applied === false
          ? "Order sudah tercatat di ERP (retry idempoten, tidak membuat order ganda)."
          : null,
      raw: json,
    };
  } catch (err) {
    return {
      ok: false,
      contract: "perpack-replica",
      httpStatus: err?.status ?? null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ---------------------------------------------------------------- read --- */

/**
 * Cari satu order di ERP berdasarkan `reference_no`.
 *
 * ERP tidak punya endpoint "GET by ref"; yang ada `POST /v1/orders/page` dengan
 * filter `search`. `search` bisa cocok sebagian, jadi hasil tetap disaring
 * `reference_no === ref` supaya tidak salah orang.
 */
export async function fetchErpOrder(cfg, ref, { length = 50 } = {}) {
  try {
    const json = await postJson(cfg, ERP_ORDER_PATHS.ordersPage, {
      page: 1,
      length,
      search: ref,
    });
    const rows = Array.isArray(json.data) ? json.data : [];
    const hits = rows.filter((r) => r && r.reference_no === ref);

    if (hits.length === 0) {
      return { ok: true, found: false, ref, scanned: rows.length, total: json.metadata?.count ?? null };
    }

    const row = hits[hits.length - 1];
    return {
      ok: true,
      found: true,
      ref,
      erpId: typeof row.id === "number" ? row.id : null,
      rawStatus: row.status ?? null,
      status: mapErpStatus(row.status),
      trackingNo: row.awb ?? null,
      courier: row.courier ?? row.courier_label ?? null,
      qty: typeof row.qty === "number" ? row.qty : null,
      totalIdr: typeof row.amount === "number" ? row.amount : null,
      productSummary: row.product_summary ?? null,
      updatedAt: row.updated_at ?? row.order_at ?? null,
      duplicates: hits.length > 1 ? hits.length : 0,
      raw: row,
    };
  } catch (err) {
    return {
      ok: false,
      found: false,
      ref,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Daftar order ERP (rekonsiliasi massal, dipakai skrip verifikasi). */
export async function listErpOrders(cfg, { status, channelId, page = 1, length = 100, search } = {}) {
  const body = { page, length };
  if (status) body.status = normalizeErpStatus(status) ?? status;
  if (channelId != null) body.channel_id = Number(channelId);
  if (search) body.search = search;

  const json = await postJson(cfg, ERP_ORDER_PATHS.ordersPage, body);
  return {
    rows: Array.isArray(json.data) ? json.data : [],
    metadata: json.metadata ?? null,
  };
}

/** Riwayat event webhook yang pernah masuk ke ERP (audit). */
export async function listWebhookEvents(cfg, { limit = 50 } = {}) {
  const json = await getJson(cfg, `${ERP_ORDER_PATHS.wmsEvents}?limit=${limit}`);
  return Array.isArray(json.data) ? json.data : [];
}

/* -------------------------------------------------------------- mutate --- */

/**
 * Majukan status order di ERP (`order.status_changed`).
 *
 * Dipakai panel admin / skrip simulasi untuk mereproduksi alur
 * `paid → process → picking → packing → packed → ready_to_pickup → sent → completed`.
 * Storefront sendiri TIDAK boleh mengarang status; ini pemicu eksplisit.
 */
export async function updateErpOrderStatus(cfg, ref, status, { trackingNo, eventId } = {}) {
  const normalized = normalizeErpStatus(status);
  if (!normalized) {
    return { ok: false, error: `Status "${status}" tidak ada di enum ERP (${ERP_STATUSES.join(", ")}).` };
  }
  try {
    const json = await postJson(cfg, ERP_ORDER_PATHS.wmsEvents, {
      event: "order.status_changed",
      event_id: eventId ?? `evt-webstore-${ref}-${normalized}-${Date.now()}`,
      data: { ref, status: normalized, ...(trackingNo ? { tracking_no: trackingNo } : {}) },
    });
    const data = json.data ?? {};
    return {
      ok: true,
      applied: data.applied !== false,
      status: normalized,
      rawStatus: normalized,
      effect: data.effect ?? null,
      raw: json,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Kirim event `stock.updated` (delta = unit terjual) ke ERP. */
export async function pushStockUpdated(cfg, materialCode, delta, { eventId } = {}) {
  try {
    const json = await postJson(cfg, ERP_ORDER_PATHS.wmsEvents, {
      event: "stock.updated",
      event_id: eventId ?? `evt-stock-${materialCode}-${Date.now()}`,
      data: { materialCode, delta },
    });
    const data = json.data ?? {};
    return { ok: true, applied: data.applied !== false, effect: data.effect ?? null, raw: json };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* --------------------------------------------------------------- stock --- */

/**
 * Stok satu SKU langsung dari ERP (bukan dari snapshot file).
 *
 * SKU satuan → `GET /v1/products/group/page?search=<sku>` lalu jumlahkan
 * `stocks[].available`. SKU bundling → `GET /api/to-be/bundle-stock?sku=<sku>`
 * karena angka "benar" bundling adalah MIN() komponen.
 */
export async function fetchErpStock(cfg, sku) {
  try {
    const bundleJson = await getJson(
      cfg,
      `${ERP_ORDER_PATHS.bundleStock}?sku=${encodeURIComponent(sku)}`,
    );
    const bundles = normalizeBundleStock(bundleJson.data).bundles;
    const hit = bundles.find((b) => b.sku === sku);
    if (hit) {
      return {
        sku,
        isBundle: true,
        available: Number(hit.stock_to_be),
        stockAsIs: Number(hit.stock_as_is),
        phantom: Number(hit.phantom),
        components: hit.components ?? [],
        raw: bundleJson,
      };
    }

    const json = await getJson(
      cfg,
      `${ERP_ORDER_PATHS.groups}?page=1&length=25&search=${encodeURIComponent(sku)}`,
    );
    const groups = Array.isArray(json.data) ? json.data : [];
    for (const g of groups) {
      for (const v of g.variants ?? []) {
        if (v.sku !== sku) continue;
        const stocks = Array.isArray(v.stocks) ? v.stocks : [];
        return {
          sku,
          isBundle: Boolean(v.is_bundle),
          available: stocks.reduce((a, s) => a + Number(s.available ?? 0), 0),
          stocks: stocks.map((s) => ({
            warehouseId: s.id,
            warehouseName: s.name,
            available: Number(s.available ?? 0),
          })),
          raw: json,
        };
      }
    }
    return { sku, available: null, found: false };
  } catch (err) {
    return { sku, available: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export { resolveErpConfig, DEFAULT_BASE_URL };
