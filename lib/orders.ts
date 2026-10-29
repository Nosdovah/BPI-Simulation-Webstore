import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  ErpLink,
  Order,
  OrderStatus,
  OrderItem,
} from "./types";
import type { PushOrderResult, ErpOrderLookup } from "./erp/types";

const SECRET = process.env.OSR_ORDER_SECRET ?? "osr-store-dev-secret-2026";

/**
 * Urutan status baku = enum ERP (replika Perpack), huruf besar.
 * Sumber kebenaran tetap ERP; storefront tidak menerjemahkan nama status.
 */
export const CANONICAL_STAGES: OrderStatus[] = [
  "PAID",
  "PROCESS",
  "PICKING",
  "PACKING",
  "PACKED",
  "READY_TO_PICKUP",
  "SENT",
  "COMPLETED",
];

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signOrder(order: Order): string {
  const payload = b64url(JSON.stringify(order));
  const mac = createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 16);
  return `${payload}.${mac}`;
}

export function readOrderToken(token: string | undefined | null): Order | null {
  if (!token || !token.includes(".")) return null;
  const [payload, mac] = token.split(".");
  const expected = createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 16);
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return JSON.parse(fromB64url(payload).toString("utf8")) as Order;
  } catch {
    return null;
  }
}

let counter = 0;

/**
 * Store in-memory: cukup untuk satu instance (lokal / lambda hangat).
 * Token bertanda tangan di URL tetap jadi sumber kebenaran kalau instance
 * berbeda, jadi order tidak pernah hilang saat di-refresh.
 */
type OrderMemory = Map<string, Order>;
const globalRef = globalThis as unknown as { __osrOrders?: OrderMemory };

function memory(): OrderMemory {
  if (!globalRef.__osrOrders) globalRef.__osrOrders = new Map();
  return globalRef.__osrOrders;
}

export function rememberOrder(order: Order) {
  memory().set(order.ref, order);
}

export function recallOrder(ref: string): Order | null {
  return memory().get(ref) ?? null;
}

export function recentOrders(limit = 20): Order[] {
  return Array.from(memory().values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/**
 * Nomor pesanan storefront.
 *
 * ERP memperlakukan `order_ref` sebagai identitas tunggal: mengirim ref yang
 * sudah ada ditolak 500. Karena itu nomor TIDAK boleh hanya bergantung pada
 * counter proses (counter reset setiap restart/hot-reload, dan dua instance
 * bisa menghasilkan nomor yang sama). Kombinasi tanggal + urutan + 5 karakter
 * acak membuat ref unik lintas restart dan lintas instance, tanpa kehilangan
 * keterbacaan.
 */
export function nextOrderRef(now = Date.now()): string {
  counter += 1;
  const d = new Date(now);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const seq = String(1000 + (counter % 9000)).slice(-4);
  const rand = randomBytes(3).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase();
  return `ORD-WEBSTORE-PROD-${yy}${mm}${dd}-${seq}-${rand}`;
}

export type TimelineEntry = {
  status: OrderStatus;
  at: number | null;
  done: boolean;
  current: boolean;
  label: string;
};

const STAGE_LABEL: Record<string, string> = {
  PAID: "Pembayaran diterima",
  PROCESS: "Pesanan diproses",
  PICKING: "Pengambilan barang",
  PACKING: "Sedang dikemas",
  PACKED: "Selesai dikemas",
  READY_TO_PICKUP: "Siap diambil kurir",
  SENT: "Dikirim",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
  RETURNED: "Dikembalikan",
};

const TERMINAL_STATUSES: OrderStatus[] = ["CANCELLED", "RETURNED"];

function stageIndex(status: OrderStatus | null | undefined): number {
  if (!status) return -1;
  return CANONICAL_STAGES.indexOf(status);
}

/**
 * Status efektif sebuah order.
 *
 * Sumber tunggal = status ERP (`order.erp.status`, hasil peta dari enum
 * replika Perpack). Storefront TIDAK mengarang kemajuan berbasis waktu: kalau
 * ERP bilang `process`, order tetap `PROCESS` sampai ERP mengirim status
 * berikutnya lewat `POST /api/webhooks/wms`. Nomor resi juga tidak dikarang —
 * hanya `awb` dari ERP yang ditampilkan.
 */
export function deriveStatus(order: Order): {
  status: OrderStatus;
  timeline: TimelineEntry[];
  note: string | null;
  trackingNo: string | null;
} {
  const erpStatus = (order.erp?.status ?? order.status) as OrderStatus | null;
  const isTerminal = erpStatus !== null && TERMINAL_STATUSES.includes(erpStatus);
  const index = erpStatus !== null ? Math.max(0, stageIndex(erpStatus)) : 0;
  const at = order.erp?.lastSyncAt ?? order.createdAt;

  const timeline: TimelineEntry[] = CANONICAL_STAGES.map((status, i) => ({
    status,
    at: i <= index ? at : null,
    done: !isTerminal && i <= index,
    current: !isTerminal && i === index,
    label: STAGE_LABEL[status] ?? status,
  }));

  if (isTerminal) {
    return {
      status: erpStatus as OrderStatus,
      timeline: timeline.map((t) => ({ ...t, done: false, current: false, at: null })),
      note:
        `Pesanan ditandai ${STAGE_LABEL[erpStatus as string]?.toLowerCase() ?? erpStatus}` +
        ` di ERP${order.erp?.rawStatus ? ` (${order.erp.rawStatus})` : ""}.`,
      trackingNo: order.erp?.trackingNo ?? order.trackingNo ?? null,
    };
  }

  const syncNote =
    order.erp && !order.erp.error && order.erp.status
      ? null
      : order.erp?.error
        ? `Sinkronisasi ERP tertunda: ${order.erp.error}`
        : null;

  return {
    status: erpStatus ?? "PAID",
    timeline,
    note: syncNote ?? order.note,
    trackingNo: order.erp?.trackingNo ?? order.trackingNo ?? null,
  };
}

/* --------------------------------------------------------------- Jalur B */

function ensureErpLink(order: Order): ErpLink {
  if (order.erp) return order.erp;
  order.erp = {
    contract: "none",
    orderRef: order.ref,
    erpId: null,
    status: null,
    rawStatus: null,
    trackingNo: null,
    pushedAt: null,
    lastSyncAt: null,
    lastSyncSource: null,
    error: null,
  };
  return order.erp;
}

/**
 * Terapkan status dari ERP ke order, tanpa regresi.
 *
 * ERP sendiri sudah menolak status mundur (`no-regression` 409), tapi pesan
 * webhook bisa datang tidak berurutan (F5 di blueprint). Karena itu storefront
 * juga menahan diri: status yang lebih awal dari status sekarang diabaikan,
 * kecuali status terminal.
 */
export function applyErpStatus(
  order: Order,
  input: {
    status: OrderStatus | null;
    rawStatus?: string | null;
    trackingNo?: string | null;
    actorLast?: "SYSTEM" | "STAFF" | null;
    source: "push" | "poll" | "webhook";
    erpId?: number | null;
    contract?: ErpLink["contract"];
    at?: number;
  },
): { changed: boolean; ignored: boolean } {
  const link = ensureErpLink(order);
  const at = input.at ?? Date.now();

  if (input.erpId != null) link.erpId = input.erpId;
  if (input.contract) link.contract = input.contract;
  if (input.rawStatus !== undefined && input.rawStatus !== null) {
    link.rawStatus = input.rawStatus;
  }
  link.lastSyncAt = at;
  link.lastSyncSource = input.source;
  link.error = null;

  if (input.trackingNo) {
    link.trackingNo = input.trackingNo;
    order.trackingNo = input.trackingNo;
  }
  if (input.actorLast) order.actorLast = input.actorLast;

  const next = input.status;
  if (!next) return { changed: false, ignored: false };

  const prevIdx = stageIndex(order.status);
  const nextIdx = stageIndex(next);
  const terminal = TERMINAL_STATUSES.includes(next);
  const regressing = !terminal && prevIdx >= 0 && nextIdx >= 0 && nextIdx < prevIdx;

  if (regressing) {
    return { changed: false, ignored: true };
  }

  const changed = order.status !== next;
  link.status = next;
  order.status = next;
  return { changed, ignored: false };
}

/** Catat hasil push checkout (POST order) ke order lokal. */
export function applyErpPush(order: Order, result: PushOrderResult): Order {
  const link = ensureErpLink(order);
  link.contract = result.contract ?? link.contract;

  if (!result.ok) {
    link.error = result.error ?? "push ke ERP gagal";
    return order;
  }

  link.orderRef = result.erpOrderRef ?? order.ref;
  link.erpId = result.erpId ?? null;
  link.pushedAt = Date.now();
  link.error = null;
  if (result.erpId != null) order.wmsOrderId = `ERP-${result.erpId}`;

  applyErpStatus(order, {
    status: (result.status as OrderStatus) ?? null,
    rawStatus: result.rawStatus ?? null,
    source: "push",
    erpId: result.erpId ?? null,
    contract: result.contract,
  });

  return order;
}

/** Catat hasil pembacaan status dari ERP (rekonsiliasi) ke order lokal. */
export function applyErpLookup(
  order: Order,
  lookup: ErpOrderLookup,
): { changed: boolean; ignored: boolean } {
  const link = ensureErpLink(order);

  if (!lookup.ok) {
    link.error = lookup.error ?? "baca status ERP gagal";
    link.lastSyncAt = Date.now();
    return { changed: false, ignored: false };
  }
  if (!lookup.found) {
    // Order belum/tidak ada di ERP: bukan error, tapi harus kelihatan.
    link.lastSyncAt = Date.now();
    link.error = link.pushedAt
      ? "Order tidak ditemukan di ERP (kemungkinan dihapus / DB ERP di-reset)."
      : null;
    return { changed: false, ignored: false };
  }

  return applyErpStatus(order, {
    status: (lookup.status as OrderStatus) ?? null,
    rawStatus: lookup.rawStatus ?? null,
    trackingNo: lookup.trackingNo ?? null,
    /* Kontrak replika Perpack tidak menyertakan aktor di /v1/orders/page,
     * jadi perubahan yang terbaca lewat polling selalu dicatat SYSTEM. */
    actorLast: "SYSTEM",
    source: "poll",
    erpId: lookup.erpId ?? null,
  });
}

export function buildOrder(args: {
  ref: string;
  customer: Order["customer"];
  shipping: Order["shipping"];
  items: OrderItem[];
}): Order {
  const subtotal = args.items.reduce((a, i) => a + i.priceIdr * i.qty, 0);
  return {
    ref: args.ref,
    wmsOrderId: `WMS-${args.ref.split("-").pop()}`,
    createdAt: Date.now(),
    channel: "WEBSTORE",
    customer: args.customer,
    shipping: args.shipping,
    items: args.items,
    subtotalIdr: subtotal,
    totalIdr: subtotal + args.shipping.costIdr,
    status: "PAID",
    trackingNo: null,
    actorLast: "SYSTEM",
    note: null,
    erp: null,
  };
}