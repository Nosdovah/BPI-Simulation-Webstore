import { NextResponse } from "next/server";
import { cartBackend, reapCarts } from "@/lib/cart-server";
import { pushTelemetry } from "@/lib/state";

/**
 * POST /api/cart/reap — bersihkan keranjang kedaluwarsa.
 *
 * Kenapa endpoint ini ada: `osr_cart_reap()` sudah dibuat di migrasi
 * `20261031000300_cart_guest.sql`, tetapi tidak ada satu pun pemanggil. Akibatnya
 * keranjang tamu yang ditinggalkan (owner_id = `guest:<uuid>`) menumpuk selamanya
 * walaupun kolom `expires_at` sudah lewat. Endpoint ini adalah pemanggilnya,
 * dirancang untuk dijalankan penjadwal (Vercel Cron / cron sistem), bukan manusia.
 *
 * Aturan keamanan:
 *   - Token WAJIB dikonfigurasi. Kalau `OSR_CART_REAP_TOKEN` (atau
 *     `OSR_WEBHOOK_TOKEN` sebagai cadangan) kosong, endpoint menjawab 503 —
 *     tidak pernah terbuka karena lupa mengisi env.
 *   - Token dibaca dari header `Authorization: Bearer <token>`,
 *     `X-OSR-Reap-Token`, atau query `?token=` (praktis untuk curl/cron).
 *   - Perbandingan memakai timingSafeEqual, bukan `===`.
 *   - GET hanya health probe (tidak menghapus apa pun).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function expectedToken(): string | null {
  const t =
    process.env.OSR_CART_REAP_TOKEN?.trim() ||
    process.env.OSR_WEBHOOK_TOKEN?.trim() ||
    "";
  return t || null;
}

function presentedToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return (
    request.headers.get("x-osr-reap-token")?.trim() ||
    new URL(request.url).searchParams.get("token")?.trim() ||
    null
  );
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "osr-cart-reaper",
    backend: cartBackend(),
    token_configured: expectedToken() !== null,
    usage: "POST /api/cart/reap dengan Authorization: Bearer <token>",
  });
}

export async function POST(request: Request) {
  const expected = expectedToken();
  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error: "REAPER_NOT_CONFIGURED",
        message: "OSR_CART_REAP_TOKEN belum diisi. Endpoint sengaja ditutup.",
      },
      { status: 503 },
    );
  }

  const given = presentedToken(request);
  if (!given || !same(given, expected)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  try {
    const deleted = await reapCarts();
    pushTelemetry({ event: "cart_reaped", deleted });
    return NextResponse.json({ ok: true, backend: cartBackend(), deleted });
  } catch (err) {
    pushTelemetry({ event: "cart_reap_failed", error: String(err) });
    return NextResponse.json(
      {
        ok: false,
        error: "REAP_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}