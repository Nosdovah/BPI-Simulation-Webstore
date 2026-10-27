import { createHmac, timingSafeEqual } from "node:crypto";
import type { Mode, Order, OrderStatus, OrderItem } from "./types";

const SECRET = process.env.OSR_ORDER_SECRET ?? "osr-sandbox-dev-secret-2026";

/** Urutan status baku (10 tahap) yang dipakai mode to-be. */
export const CANONICAL_STAGES: OrderStatus[] = [
  "PAID",
  "PROCESSING",
  "PICKING",
  "PACKED",
  "HANDOVER_TO_COURIER",
  "IN_TRANSIT",
  "ARRIVED_AT_HUB",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
];

/** Durasi satu tahap di simulasi (detik) — dikompres supaya demo cepat. */
export const STAGE_MS = 7000;

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
 * Store in-memory: cukup untuk demo satu instance (lokal / lambda hangat).
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

export function nextOrderRef(now = Date.now()): string {
  counter += 1;
  const d = new Date(now);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const seq = String(1000 + (counter % 9000)).slice(-4);
  return `ORD-WEBSTORE-PROD-${yy}${mm}${dd}-${seq}`;
}

export type TimelineEntry = {
  status: OrderStatus;
  at: number | null;
  done: boolean;
  current: boolean;
  label: string;
};

const STAGE_LABEL: Record<string, string> = {
  SENT: "SENT — status mentah dari WMS",
  on_process: "on_process — enum tidak baku",
  PAID: "Pembayaran diterima",
  PROCESSING: "Pesanan diproses",
  PICKING: "Pengambilan barang",
  PACKED: "Dikemas",
  HANDOVER_TO_COURIER: "Diserahkan ke kurir",
  IN_TRANSIT: "Dalam perjalanan",
  ARRIVED_AT_HUB: "Tiba di hub",
  OUT_FOR_DELIVERY: "Diantar kurir",
  DELIVERED: "Diterima",
  COMPLETED: "Selesai",
};

export function deriveStatus(
  order: Order,
  now = Date.now(),
): { status: OrderStatus; timeline: TimelineEntry[]; stuck: boolean; note: string | null; trackingNo: string | null } {
  if (order.mode === "baseline") {
    // Cacat yang direproduksi: order masuk sebagai SENT, sub-status on_process,
    // dan tidak pernah maju karena status hanya berubah kalau staff klik manual.
    const timeline: TimelineEntry[] = [
      { status: "PAID", at: order.createdAt, done: true, current: false, label: STAGE_LABEL.PAID },
      { status: "on_process", at: order.createdAt + 1000, done: true, current: false, label: STAGE_LABEL.on_process },
      { status: "SENT", at: order.createdAt + 2000, done: true, current: true, label: STAGE_LABEL.SENT },
    ];
    return {
      status: order.status === "COMPLETED" ? "COMPLETED" : "SENT",
      timeline,
      stuck: order.status !== "COMPLETED",
      note: order.status === "COMPLETED"
        ? "Status diselesaikan lewat klik manual staff."
        : "Macet di SENT. Webhook balik dengan payload kosong, jadi status tidak pernah naik. Butuh klik manual staff di WMS.",
      trackingNo: order.trackingNo,
    };
  }

  const elapsed = Math.max(0, now - order.createdAt);
  const index = Math.min(
    CANONICAL_STAGES.length - 1,
    Math.floor(elapsed / STAGE_MS),
  );
  const timeline: TimelineEntry[] = CANONICAL_STAGES.map((status, i) => ({
    status,
    at: order.createdAt + i * STAGE_MS,
    done: i <= index,
    current: i === index,
    label: STAGE_LABEL[status] ?? status,
  }));

  return {
    status: CANONICAL_STAGES[index],
    timeline,
    stuck: false,
    note: null,
    trackingNo:
      index >= 4
        ? order.trackingNo ?? `SCP${String(order.createdAt).slice(-10)}`
        : null,
  };
}

export function buildOrder(args: {
  ref: string;
  mode: Mode;
  customer: Order["customer"];
  shipping: Order["shipping"];
  items: OrderItem[];
}): Order {
  const subtotal = args.items.reduce((a, i) => a + i.priceIdr * i.qty, 0);
  return {
    ref: args.ref,
    wmsOrderId: args.mode === "tobe" ? `WMS-${args.ref.split("-").pop()}` : null,
    createdAt: Date.now(),
    mode: args.mode,
    channel: "WEBSTORE",
    customer: args.customer,
    shipping: args.shipping,
    items: args.items,
    subtotalIdr: subtotal,
    totalIdr: subtotal + args.shipping.costIdr,
    status: args.mode === "baseline" ? "SENT" : "PAID",
    trackingNo: null,
    actorLast: args.mode === "baseline" ? "STAFF" : "SYSTEM",
    note:
      args.mode === "baseline"
        ? "Order dikirim ke WMS 4.2 dengan payload tanpa idempotency; status balik kosong."
        : null,
  };
}