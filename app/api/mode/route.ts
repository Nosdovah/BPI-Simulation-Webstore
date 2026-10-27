import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { MODE_COOKIE, parseMode } from "@/lib/state";

/** POST /api/mode  { mode: "baseline" | "tobe" } */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "baseline" ? "baseline" : "tobe";

  const res = NextResponse.json({ ok: true, mode });
  res.cookies.set(MODE_COOKIE, mode, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
  });
  return res;
}

/**
 * GET /api/mode            -> { mode }
 * GET /api/mode?mode=tobe  -> set cookie lalu redirect (dipakai panel simulasi)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("mode");

  if (requested) {
    const mode = requested === "baseline" ? "baseline" : "tobe";
    const redirectTo = url.searchParams.get("next") ?? "/admin/simulasi";
    const res = NextResponse.redirect(new URL(redirectTo, url.origin));
    res.cookies.set(MODE_COOKIE, mode, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
    });
    return res;
  }

  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);
  return NextResponse.json({ mode });
}