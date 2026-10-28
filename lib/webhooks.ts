import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { addSold } from "./state";
import { recallOrder, rememberOrder } from "./orders";
import type { OrderStatus } from "./types";

/**
 * Webhook receiver untuk integrasi ERP → osr-core.
 *
 * Arah: ERP (WMS 4.1 / Order 4.2)  ──push──▶  core (repo ini)
 *
 * Kontrak minimal:
 *   POST /api/webhooks/wms
 *   Authorization: Bearer <OSR_WEBHOOK_TOKEN>
 *   X-OSR-Signature: sha256=<hmac(body, OSR_WEBHOOK_HMAC_SECRET)>   (opsional, wajib kalau secret diisi)
 *   Idempotency-Key: <string>                                        (opsional tapi disarankan)
 *
 * Body:
 *   { "event": "stock.updated", "event_id": "...", "occurred_at": 1699999999, "data": { ... } }
 *
 * Event yang punya efek samping di core:
 *   - stock.updated       → menambah "terjual" komponen sehingga stok bundle ikut turun
 *   - order.status_changed→ memperbarui status/tracking order yang dikenal core
 * Event lain (catalog.updated, shipment.updated, ping) hanya dicatat + di-ack.
 */

export type WebhookEvent = {
  event: string;
  event_id?: string;
  occurred_at?: number;
  source?: string;
  data?: Record<string, unknown>;
};

export type StoredEvent = WebhookEvent & {
  received_at: number;
  dedupe_key: string;
  dedupe_keys?: string[];
  applied: boolean;
  apply_note: string | null;
  remote_ip: string | null;
  signature_verified?: boolean;
};

type WebhookState = {
  events: StoredEvent[];
  seen: Map<string, number>;
  counters: {
    received: number;
    accepted: number;
    duplicates: number;
    rejected: number;
    applied: number;
  };
  startedAt: number;
};

const MAX_EVENTS = 500;
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

const globalRef = globalThis as unknown as { __osrWebhooks?: WebhookState };

function state(): WebhookState {
  if (!globalRef.__osrWebhooks) {
    globalRef.__osrWebhooks = {
      events: [],
      seen: new Map(),
      counters: {
        received: 0,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
        applied: 0,
      },
      startedAt: Date.now(),
    };
    rehydrate(globalRef.__osrWebhooks);
  }
  return globalRef.__osrWebhooks;
}

/**
 * Pulihkan state dedupe dari `.data/webhook-events.jsonl` setelah restart.
 *
 * Tanpa ini, `seen` kosong setiap proses baru → retry event yang dikirim
 * sebelum restart akan diterapkan dua kali (stok/status ter-dobel).
 */
function rehydrate(s: WebhookState) {
  try {
    const file = path.join(process.cwd(), ".data", "webhook-events.jsonl");
    if (!existsSync(file)) return;
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      let entry: StoredEvent;
      try {
        entry = JSON.parse(line) as StoredEvent;
      } catch {
        continue;
      }
      const at = typeof entry.received_at === "number" ? entry.received_at : Date.now();
      for (const k of entry.dedupe_keys ?? [entry.dedupe_key]) {
        if (typeof k === "string" && k) s.seen.set(k, at);
      }
      s.events.unshift(entry);
    }
    if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS;
  } catch {
    // Best-effort: kalau file tak terbaca, receiver tetap jalan.
  }
}

/* ---------------------------------------------------------------- auth --- */

export function expectedToken(): string | null {
  const raw = process.env.OSR_WEBHOOK_TOKEN;
  return raw && raw.trim().length >= 16 ? raw.trim() : null;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type AuthResult =
  | { ok: true; via: "bearer" | "header" | "query" | "unsigned" }
  | { ok: false; reason: string; status: number };

export function authenticate(req: Request): AuthResult {
  const token = expectedToken();
  if (!token) {
    return {
      ok: false,
      reason:
        "OSR_WEBHOOK_TOKEN belum diset di server. Isi .env.local lalu restart.",
      status: 503,
    };
  }

  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return safeEqual(auth.slice(7).trim(), token)
      ? { ok: true, via: "bearer" }
      : { ok: false, reason: "Token bearer tidak valid.", status: 401 };
  }

  const headerToken = req.headers.get("x-osr-webhook-token");
  if (headerToken) {
    return safeEqual(headerToken.trim(), token)
      ? { ok: true, via: "header" }
      : { ok: false, reason: "Header X-OSR-Webhook-Token tidak valid.", status: 401 };
  }

  const queryToken = new URL(req.url).searchParams.get("token");
  if (queryToken) {
    return safeEqual(queryToken.trim(), token)
      ? { ok: true, via: "query" }
      : { ok: false, reason: "Query token tidak valid.", status: 401 };
  }

  return {
    ok: false,
    reason:
      "Kredensial webhook tidak ada. Kirim Authorization: Bearer <token>.",
    status: 401,
  };
}

export function verifySignature(rawBody: string, signature: string | null): AuthResult {
  const secret = process.env.OSR_WEBHOOK_HMAC_SECRET?.trim();
  if (!secret) return { ok: true, via: "bearer" };

  // Mode transisi: `warn` = secret sudah dipasang tapi signer di sisi ERP belum
  // deploy. Event tanpa signature tetap diterima, ditandai `unsigned` supaya
  // kelihatan di log/response. Setelah sender siap, ubah ke `enforce`.
  const mode = (process.env.OSR_WEBHOOK_HMAC_MODE ?? "enforce").trim().toLowerCase();

  if (!signature) {
    if (mode === "warn") {
      console.warn("[webhook] event tanpa X-OSR-Signature (mode=warn) — akan ditolak di mode enforce.");
      return { ok: true, via: "unsigned" };
    }
    return {
      ok: false,
      reason:
        "OSR_WEBHOOK_HMAC_SECRET aktif, tetapi header X-OSR-Signature tidak dikirim.",
      status: 401,
    };
  }

  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(provided.trim(), expected)
    ? { ok: true, via: "bearer" }
    : { ok: false, reason: "Signature HMAC tidak cocok.", status: 401 };
}

/* ------------------------------------------------------------ dedupe --- */

/**
 * Kunci dedupe.
 *
 * ATURAN KANONIK: `event_id` SELALU menang atas Idempotency-Key.
 * Alasannya: Idempotency-Key adalah header transport yang bisa hilang saat
 * retry (proxy, queue, library HTTP). Kalau header jadi prioritas, satu event
 * yang sama bisa masuk dua kali dengan key berbeda → double-apply.
 * Idempotency-Key hanya dipakai sebagai kunci tambahan (alias) supaya retry
 * yang membawa header tetap tertangkap.
 */
function dedupeKeys(body: WebhookEvent, idempotencyKey: string | null): string[] {
  const keys: string[] = [];
  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  if (eventId) keys.push(`evt:${body.event}:${eventId}`);
  if (idempotencyKey) keys.push(`idem:${idempotencyKey.trim()}`);
  if (keys.length === 0) {
    keys.push(
      `hash:${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32)}`,
    );
  }
  return keys;
}

function pruneSeen(s: WebhookState) {
  const cutoff = Date.now() - DEDUPE_TTL_MS;
  for (const [key, at] of s.seen) {
    if (at < cutoff) s.seen.delete(key);
  }
}

/* ------------------------------------------------------------- apply --- */

const ORDER_STATUSES: OrderStatus[] = [
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

// Kode material = SKU master data ERP (mis. SKU-SP-FAN-017, PB-ARES-78X).
// Format lama M### tetap diterima supaya kontrak webhook lama tidak putus.
const MATERIAL_RE = /^(M\d{3,}|[A-Za-z0-9][A-Za-z0-9._-]{2,})$/;

function applyEvent(body: WebhookEvent): { applied: boolean; note: string | null } {
  const data = body.data ?? {};

  if (body.event === "stock.updated" || body.event === "inventory.updated") {
    const materialCode = String(
      data.materialCode ?? data.material_code ?? data.sku ?? "",
    ).trim();
    if (!MATERIAL_RE.test(materialCode)) {
      return {
        applied: false,
        note: `materialCode "${materialCode}" tidak valid (harus M###).`,
      };
    }
    const delta = Number(
      data.delta ?? data.qty_sold ?? data.quantity_sold ?? data.quantity ?? 0,
    );
    if (!Number.isFinite(delta) || delta === 0) {
      return { applied: false, note: "delta/quantity nol atau tidak numerik." };
    }
    addSold(materialCode, Math.trunc(delta));
    return {
      applied: true,
      note: `komponen ${materialCode} bertambah terjual ${Math.trunc(delta)} unit.`,
    };
  }

  if (body.event === "order.status_changed" || body.event === "order.updated") {
    const ref = String(data.ref ?? data.order_ref ?? data.orderRef ?? "").trim();
    if (!ref) return { applied: false, note: "ref order kosong." };

    const order = recallOrder(ref);
    if (!order) {
      return { applied: false, note: `order ${ref} tidak dikenal di core (diabaikan).` };
    }

    const rawStatus = String(data.status ?? "").trim();
    if (!ORDER_STATUSES.includes(rawStatus as OrderStatus)) {
      return { applied: false, note: `status "${rawStatus}" bukan enum baku.` };
    }

    order.status = rawStatus as OrderStatus;
    const tracking = data.tracking_no ?? data.trackingNo;
    if (typeof tracking === "string" && tracking.trim()) {
      order.trackingNo = tracking.trim();
    }
    order.actorLast = data.actor === "STAFF" ? "STAFF" : "SYSTEM";
    order.note =
      typeof data.note === "string" && data.note.trim() ? data.note.trim() : order.note;
    rememberOrder(order);
    return { applied: true, note: `order ${ref} → ${rawStatus}.` };
  }

  if (body.event === "ping" || body.event === "health.check") {
    return { applied: true, note: "ping di-ack." };
  }

  return { applied: false, note: `event "${body.event}" dicatat tanpa handler.` };
}

/* ------------------------------------------------------------ ingest --- */

function persist(entry: StoredEvent) {
  try {
    const dir = path.join(process.cwd(), ".data");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      path.join(dir, "webhook-events.jsonl"),
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
  } catch {
    // Persistensi bersifat best-effort; receiver tetap jalan tanpa disk writable.
  }
}

export type IngestResult =
  | { ok: true; status: 200 | 202; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

export function ingest(
  rawBody: string,
  idempotencyKey: string | null,
  remoteIp: string | null,
  signatureVerified = true,
): IngestResult {
  const s = state();
  s.counters.received += 1;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    s.counters.rejected += 1;
    return {
      ok: false,
      status: 400,
      body: { ok: false, error: "INVALID_JSON", message: "Body bukan JSON valid." },
    };
  }

  const body = parsed as WebhookEvent;
  if (!body || typeof body !== "object" || typeof body.event !== "string" || !body.event.trim()) {
    s.counters.rejected += 1;
    return {
      ok: false,
      status: 422,
      body: {
        ok: false,
        error: "MISSING_EVENT",
        message: 'Field "event" wajib ada dan berupa string.',
      },
    };
  }
  body.event = body.event.trim();

  const keys = dedupeKeys(body, idempotencyKey);
  const key = keys[0];
  pruneSeen(s);
  const hit = keys.find((k) => s.seen.has(k));
  if (hit) {
    s.counters.duplicates += 1;
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        duplicate: true,
        dedupe_key: hit,
        canonical_key: key,
        message: "Event sudah pernah diterima; tidak diterapkan ulang.",
      },
    };
  }

  const result = applyEvent(body);
  if (result.applied) s.counters.applied += 1;

  const entry: StoredEvent = {
    ...body,
    received_at: Date.now(),
    dedupe_key: key,
    dedupe_keys: keys,
    applied: result.applied,
    apply_note: result.note,
    remote_ip: remoteIp,
    signature_verified: signatureVerified,
  };

  for (const k of keys) s.seen.set(k, Date.now());
  s.events.unshift(entry);
  if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS;
  s.counters.accepted += 1;
  persist(entry);

  return {
    ok: true,
    status: 202,
    body: {
      ok: true,
      duplicate: false,
      event: body.event,
      dedupe_key: key,
      applied: result.applied,
      note: result.note,
      received_at: entry.received_at,
    },
  };
}

/* -------------------------------------------------------------- read --- */

export function readEvents(limit = 50) {
  const s = state();
  return {
    ok: true,
    receiver: "osr-core",
    path: "/api/webhooks/wms",
    uptime_ms: Date.now() - s.startedAt,
    counters: s.counters,
    stored: s.events.length,
    events: s.events.slice(0, Math.max(1, Math.min(limit, MAX_EVENTS))),
  };
}

export function tokenFingerprint(): string | null {
  const token = expectedToken();
  if (!token) return null;
  return `…${token.slice(-4)}`;
}
