import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ingestErpEvent, readErpEvents } from "@/lib/erp/events-store";

export const dynamic = "force-dynamic";

/**
 * Jalur C-push: ERP → storefront.
 *
 *   POST /api/webhooks/erp/events
 *   Header  : X-Perpack-Signature: <hex hmac-sha256(body, secret)>
 *             X-Perpack-Event-Id  : <id unik event>
 *             X-Perpack-Event     : order.status_changed | stock.updated | push.test
 *   Body    : {"event","event_id","timestamp","data":{...}}
 *
 * KENAPA ROUTE BARU, BUKAN `/api/webhooks/wms`
 *   `/api/webhooks/wms` adalah arah storefront → ERP (kita yang mengirim).
 *   Endpoint ini arah sebaliknya. Menggabungkan keduanya membuat arah event
 *   tidak bisa dibedakan dari log, dan itu sudah pernah menimbulkan salah baca
 *   di audit (A-11: "20 event di log ERP semuanya INBOUND").
 *
 * PARITAS SIGNATURE (A-12)
 *   ERP menandatangani body MENTAH dengan HMAC-SHA256 dan mengirim hex di
 *   `X-Perpack-Signature`. Verifikasi dilakukan terhadap byte yang benar-benar
 *   diterima (`request.text()`), bukan hasil `JSON.stringify` ulang — urutan
 *   kunci & spasi akan berbeda dan setiap push akan gagal.
 *
 *   Secret dicari berurutan: OSR_ERP_PUSH_SECRET → OSR_WEBHOOK_HMAC_SECRET.
 *   Satu secret dipakai dua arah, jadi tidak ada dua sumber kebenaran.
 *   `OSR_ERP_PUSH_MODE=warn` menerima event tak bertanda tangan tetapi
 *   menandainya `signature_ok:false` (masa transisi); `enforce` (default)
 *   menolak 401.
 */

const MAX_SKEW_MS = Number(process.env.OSR_ERP_PUSH_MAX_SKEW_MS ?? 5 * 60 * 1000);

function secret(): string | null {
  const s =
    process.env.OSR_ERP_PUSH_SECRET?.trim() ||
    process.env.OSR_WEBHOOK_HMAC_SECRET?.trim() ||
    "";
  return s || null;
}

function mode(): "enforce" | "warn" {
  return (process.env.OSR_ERP_PUSH_MODE ?? "enforce").trim().toLowerCase() === "warn" ? "warn" : "enforce";
}

type SigResult = { ok: boolean; via: "hmac" | "unsigned" | "none"; reason?: string; status?: number };

function verify(rawBody: string, header: string | null): SigResult {
  const key = secret();
  if (!key) {
    // Belum ada secret sama sekali: terima tetapi tandai, supaya demo tidak
    // mati — dan status ini terlihat jelas di GET (secret_set:false).
    return { ok: true, via: "none" };
  }
  if (!header) {
    if (mode() === "warn") return { ok: true, via: "unsigned" };
    return { ok: false, via: "none", reason: "Signature tidak dikirim.", status: 401 };
  }
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", key).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(provided.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, via: "none", reason: "Signature HMAC tidak cocok.", status: 401 };
  }
  return { ok: true, via: "hmac" };
}

/** GET — probe + daftar event yang benar-benar tersimpan. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "25") || 25;
  const feed = await readErpEvents(limit);
  return NextResponse.json({
    ok: true,
    receiver: "osr-webstore / erp-push",
    path: "/api/webhooks/erp/events",
    backend: feed.backend,
    secret_set: secret() !== null,
    mode: mode(),
    signature_header: "X-Perpack-Signature",
    returned: feed.returned,
    events: feed.events,
  });
}

/** POST — terima event dari ERP. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return NextResponse.json(
      { ok: false, error: "EMPTY_BODY", message: "Body webhook kosong." },
      { status: 400 },
    );
  }

  const sig = verify(rawBody, request.headers.get("x-perpack-signature"));
  if (!sig.ok) {
    return NextResponse.json(
      { ok: false, error: "BAD_SIGNATURE", message: sig.reason },
      { status: sig.status ?? 401 },
    );
  }

  // Tolak event yang terlalu tua/terlalu jauh di masa depan hanya kalau
  // timestamp dikirim — tanpa timestamp, verifikasi umur tidak mungkin dan
  // event tetap diproses (dedupe event_id tetap berlaku).
  const headerTs = request.headers.get("x-perpack-timestamp");
  if (headerTs) {
    const t = Date.parse(headerTs);
    if (Number.isFinite(t) && Math.abs(Date.now() - t) > MAX_SKEW_MS) {
      return NextResponse.json(
        {
          ok: false,
          error: "TIMESTAMP_SKEW",
          message: `Selisih timestamp ${Math.round(Math.abs(Date.now() - t) / 1000)} dtk melebihi batas ${MAX_SKEW_MS / 1000} dtk.`,
          timestamp: headerTs,
        },
        { status: 409 },
      );
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", message: "Body bukan JSON valid." },
      { status: 400 },
    );
  }

  const body = parsed as {
    event?: string;
    event_id?: string;
    timestamp?: string;
    data?: Record<string, unknown>;
  };

  const event = typeof body.event === "string" ? body.event.trim() : "";
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "MISSING_EVENT", message: 'Field "event" wajib ada.' },
      { status: 422 },
    );
  }

  // Kunci dedupe: event_id dari ERP SELALU menang. Kalau ERP tidak mengirimnya,
  // pakai hash isi body supaya retry byte-identik tidak menggandakan efek.
  const eventId =
    (typeof body.event_id === "string" && body.event_id.trim()) ||
    (request.headers.get("x-perpack-event-id") ?? "").trim() ||
    `sha256:${createHmac("sha256", "osr-dedupe").update(rawBody, "utf8").digest("hex").slice(0, 40)}`;

  const data = body.data ?? {};
  const ref =
    (typeof data.reference_no === "string" && data.reference_no) ||
    (typeof data.ref === "string" && data.ref) ||
    (typeof data.order_ref === "string" && data.order_ref) ||
    null;

  const result = await ingestErpEvent({
    eventId,
    event,
    ref,
    payload: parsed,
    signatureOk: sig.via === "hmac",
    signatureVia: sig.via,
  });

  return NextResponse.json(
    {
      ok: true,
      duplicate: result.duplicate,
      applied: result.inserted,
      event,
      event_id: eventId,
      ref,
      status: result.status,
      signature_via: sig.via,
      backend: result.backend,
      message: result.duplicate
        ? "Event sudah pernah diterima; tidak diterapkan ulang."
        : "Event diterima dan dicatat.",
    },
    { status: result.duplicate ? 200 : 202 },
  );
}
