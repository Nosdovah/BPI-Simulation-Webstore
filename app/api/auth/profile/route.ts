import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentSession } from "@/lib/auth/guard";
import { can } from "@/lib/auth/rbac";
import { updateProfile } from "@/lib/auth/store";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/auth/session";
import { toPublicUser } from "@/lib/auth/types";

/**
 * PATCH /api/auth/profile — ubah nama & nomor telepon milik sendiri.
 *
 * Email, role, dan status TIDAK bisa diubah lewat endpoint ini. Role hanya
 * lewat /api/admin/users (butuh user:assign_role), status hanya lewat sana
 * juga (butuh user:update).
 *
 * Setelah nama berubah, cookie sesi ditandatangani ulang supaya header
 * langsung menampilkan nama baru tanpa perlu logout.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const session = currentSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHENTICATED", message: "Belum masuk." },
      { status: 401 }
    );
  }
  if (!can(session.roles, "profile:update")) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Role Anda tidak boleh mengubah profil." },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", message: "Body harus JSON yang valid." },
      { status: 400 }
    );
  }

  const name = body.name === undefined ? undefined : String(body.name).trim();
  if (name !== undefined) {
    if (name.length < 2) {
      return NextResponse.json(
        { ok: false, error: "INVALID_NAME", message: "Nama minimal 2 karakter." },
        { status: 400 }
      );
    }
    if (name.length > 80) {
      return NextResponse.json(
        { ok: false, error: "INVALID_NAME", message: "Nama maksimal 80 karakter." },
        { status: 400 }
      );
    }
  }

  const phone =
    body.phone === undefined ? undefined : body.phone === null ? null : String(body.phone);

  const updated = await updateProfile(session.uid, { name, phone });
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "User tidak ditemukan." },
      { status: 404 }
    );
  }

  const token = signSession({
    uid: updated.id,
    email: updated.email,
    name: updated.name,
    roles: updated.roles,
    primaryRole: updated.primaryRole,
    status: updated.status,
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

  return NextResponse.json({ ok: true, user: toPublicUser(updated) });
}
