import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { findByEmail, touchLogin } from "@/lib/auth/store";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/rbac";
import { toPublicUser } from "@/lib/auth/types";
import { clearGuestCookie, GUEST_PREFIX, readGuestId } from "@/lib/cart-owner";
import { mergeCarts } from "@/lib/cart-server";
import { pushTelemetry } from "@/lib/state";

/**
 * POST /api/auth/login
 *
 * Body: { email, password }
 *
 * Pesan error sengaja digabung ("Email atau password salah") supaya tidak
 * bisa dipakai menebak email mana yang terdaftar (user enumeration).
 * Satu-satunya pengecualian: akun SUSPENDED diberi pesan sendiri agar
 * pemiliknya tahu harus menghubungi admin.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", message: "Body harus JSON yang valid." },
      { status: 400 }
    );
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "MISSING_FIELDS", message: "Email dan password wajib diisi." },
      { status: 400 }
    );
  }

  let user;
  try {
    user = await findByEmail(email);
  } catch (err) {
    // Backend user (Supabase) tidak bisa dihubungi. Jangan berpura-pura
    // kredensial salah — pengguna harus tahu ini masalah sistem, bukan
    // salah ketik password.
    return NextResponse.json(
      {
        ok: false,
        error: "AUTH_BACKEND_UNAVAILABLE",
        message: err instanceof Error ? err.message : "Penyimpanan akun tidak bisa diakses.",
      },
      { status: 503 }
    );
  }
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "INVALID_CREDENTIALS", message: "Email atau password salah." },
      { status: 401 }
    );
  }

  const valid = verifyPassword(password, {
    hash: user.passwordHash,
    salt: user.passwordSalt,
  });
  if (!valid) {
    return NextResponse.json(
      { ok: false, error: "INVALID_CREDENTIALS", message: "Email atau password salah." },
      { status: 401 }
    );
  }

  if (user.status === "SUSPENDED") {
    return NextResponse.json(
      {
        ok: false,
        error: "ACCOUNT_SUSPENDED",
        message: "Akun dinonaktifkan. Hubungi Super Admin.",
      },
      { status: 403 }
    );
  }

  if (user.status === "PENDING") {
    return NextResponse.json(
      {
        ok: false,
        error: "ACCOUNT_PENDING",
        message: "Akun menunggu persetujuan Super Admin.",
      },
      { status: 403 }
    );
  }

  await touchLogin(user.id);

  /* ------------------------------------------------- keranjang tamu ---
   * Tamu boleh mengisi keranjang sebelum masuk. Saat login berhasil, isi
   * keranjang tamu dipindahkan ke keranjang akun (qty dijumlahkan, dijepit 99)
   * dan cookie tamu dihapus. Kegagalan penggabungan TIDAK boleh menggagalkan
   * login — pengguna tetap masuk, hanya barangnya tidak berpindah, dan kejadian
   * itu dicatat ke telemetri supaya kelihatan.
   */
  let mergedItems = 0;
  const guestId = readGuestId();
  if (guestId) {
    try {
      mergedItems = await mergeCarts(`${GUEST_PREFIX}${guestId}`, user.id);
    } catch (err) {
      pushTelemetry({ event: "cart_merge_failed", uid: user.id, error: String(err) });
    }
    clearGuestCookie();
  }

  const token = signSession({
    uid: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    primaryRole: user.primaryRole,
    status: user.status,
  });

  cookies().set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return NextResponse.json({
    ok: true,
    user: toPublicUser(user),
    redirectTo: isAdminRole(user.primaryRole) ? "/admin" : "/akun",
    cart: { mergedItems },
  });
}
