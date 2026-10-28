import { NextResponse } from "next/server";
import {
  authenticate,
  expectedToken,
  ingest,
  readEvents,
  tokenFingerprint,
  verifySignature,
} from "@/lib/webhooks";

export const dynamic = "force-dynamic";

function clientIp(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null
  );
}

/**
 * GET /api/webhooks/wms
 *
 * Dua kegunaan:
 *   - Tanpa token  → health probe ringan (tidak membocorkan data event)
 *   - Dengan token → daftar event terakhir + counter (untuk verifikasi integrasi)
 */
export async function GET(request: Request) {
  const hasCredential =
    request.headers.get("authorization") ||
    request.headers.get("x-osr-webhook-token") ||
    new URL(request.url).searchParams.get("token");

  if (!hasCredential) {
    return NextResponse.json(
      {
        ok: true,
        service: "osr-core webhook receiver",
        path: "/api/webhooks/wms",
        token_configured: expectedToken() !== null,
        token_fingerprint: tokenFingerprint(),
        auth: ["Authorization: Bearer <token>", "X-OSR-Webhook-Token: <token>"],
        note: "Kirim token untuk melihat daftar event.",
      },
      { status: 200 },
    );
  }

  const auth = authenticate(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: auth.reason },
      { status: auth.status },
    );
  }

  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  return NextResponse.json(readEvents(Number.isFinite(limit) ? limit : 50), {
    status: 200,
  });
}

/**
 * POST /api/webhooks/wms — titik masuk event dari ERP.
 */
export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: auth.reason },
      { status: auth.status },
    );
  }

  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return NextResponse.json(
      { ok: false, error: "EMPTY_BODY", message: "Body webhook kosong." },
      { status: 400 },
    );
  }

  // Signature diverifikasi terhadap raw body (bukan hasil parse) supaya
  // byte-order tetap utuh seperti yang dikirim ERP.
  const sig = verifySignature(rawBody, request.headers.get("x-osr-signature"));
  if (!sig.ok) {
    return NextResponse.json(
      { ok: false, error: "BAD_SIGNATURE", message: sig.reason },
      { status: sig.status },
    );
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  const result = ingest(rawBody, idempotencyKey, clientIp(request), sig.via !== "unsigned");
  return NextResponse.json(result.body, { status: result.status });
}
