import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createUser, findByEmail, StoreError } from "@/lib/auth/store";
import { validateEmail, validatePassword } from "@/lib/auth/password";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/auth/session";
import { REGISTERABLE_ROLES, isAdminRole } from "@/lib/auth/rbac";
import { isRole, toPublicUser, type Role } from "@/lib/auth/types";

/**
 * POST /api/auth/register
 *
 * Dua jalur pendaftaran dalam satu endpoint, dibedakan oleh `mode`:
 *
 *   mode = "customer"  → siapa pun boleh daftar. Role selalu CUSTOMER.
 *                        Status langsung ACTIVE.
 *
 *   mode = "admin"     → wajib menyertakan `inviteCode` yang cocok dengan
 *                        OSR_ADMIN_INVITE_CODE. Role dipilih dari ADMIN_ROLES.
 *                        Tanpa kode yang benar, permintaan ditolak 403 —
 *                        ini yang mencegah siapa pun menaikkan dirinya
 *                        menjadi admin hanya dengan mengubah body request.
 *
 * Body:
 *   { mode, email, password, name, phone?, role?, inviteCode? }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_INVITE = "OSR-ADMIN-2026";

function inviteCode(): string {
  return process.env.OSR_ADMIN_INVITE_CODE?.trim() || DEFAULT_INVITE;
}

function bad(error: string, message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, message, ...extra }, { status });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("INVALID_JSON", "Body harus JSON yang valid.");
  }

  const mode = String(body.mode ?? "customer").trim().toLowerCase();
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim();
  const phone = body.phone ? String(body.phone).trim() : null;
  const invite = body.inviteCode ? String(body.inviteCode).trim() : "";

  if (mode !== "customer" && mode !== "admin") {
    return bad("INVALID_MODE", 'Mode harus "customer" atau "admin".');
  }

  const emailErr = validateEmail(email);
  if (emailErr) return bad("INVALID_EMAIL", emailErr);

  const passErr = validatePassword(password);
  if (passErr) return bad("INVALID_PASSWORD", passErr);

  if (name.length < 2) return bad("INVALID_NAME", "Nama minimal 2 karakter.");
  if (name.length > 80) return bad("INVALID_NAME", "Nama maksimal 80 karakter.");

  let role: Role = "CUSTOMER";

  if (mode === "admin") {
    if (invite !== inviteCode()) {
      return bad(
        "INVALID_INVITE",
        "Kode undangan admin tidak valid. Hubungi Super Admin.",
        403
      );
    }
    const requested = String(body.role ?? "ADMIN_KATALOG").trim().toUpperCase();
    if (!isRole(requested) || !REGISTERABLE_ROLES.includes(requested)) {
      return bad(
        "INVALID_ROLE",
        `Role admin harus salah satu dari: ${REGISTERABLE_ROLES.join(", ")}. ` +
          "SUPER_ADMIN hanya dapat ditetapkan oleh Super Admin lain lewat panel admin."
      );
    }
    role = requested;
  } else {
    // Customer tidak boleh memilih role sendiri, walaupun mengirim field role.
    role = "CUSTOMER";
  }

  const existing = await findByEmail(email);
  if (existing) {
    return bad("EMAIL_TAKEN", "Email sudah terdaftar. Silakan masuk.", 409);
  }

  try {
    const created = await createUser({ email, password, name, phone, role });

    const token = signSession({
      uid: created.id,
      email: created.email,
      name: created.name,
      roles: created.roles,
      primaryRole: created.primaryRole,
      status: created.status,
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

    return NextResponse.json(
      {
        ok: true,
        user: toPublicUser(created),
        redirectTo: isAdminRole(created.primaryRole) ? "/admin" : "/akun",
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof StoreError) {
      return bad(err.code, err.message, err.code === "EMAIL_TAKEN" ? 409 : 400);
    }
    return bad(
      "REGISTER_FAILED",
      err instanceof Error ? err.message : "Registrasi gagal.",
      500
    );
  }
}

/** GET — dipakai form untuk memeriksa ketersediaan email sebelum submit. */
export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email")?.trim() ?? "";
  if (!email) return bad("MISSING_EMAIL", "Parameter email wajib diisi.");
  const emailErr = validateEmail(email);
  if (emailErr) return bad("INVALID_EMAIL", emailErr);

  const existing = await findByEmail(email);
  return NextResponse.json({ ok: true, email, available: !existing });
}
