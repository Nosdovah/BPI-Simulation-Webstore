import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/guard";
import { can } from "@/lib/auth/rbac";
import {
  listUsers,
  setUserRoles,
  setUserStatus,
} from "@/lib/auth/store";
import { isRole, toPublicUser, type Role, type UserStatus } from "@/lib/auth/types";

/**
 * /api/admin/users — manajemen user.
 *
 * GET   → daftar user (butuh `user:read`)
 * PATCH → ubah status atau role (butuh `user:update` / `user:assign_role`)
 *
 * Hanya role yang punya izin tersebut yang lolos — saat ini praktis hanya
 * SUPER_ADMIN. Pengaman tambahan: SUPER_ADMIN tidak boleh menurunkan status
 * atau role dirinya sendiri, supaya sistem tidak bisa terkunci tanpa admin.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = currentSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHENTICATED", message: "Belum masuk." },
      { status: 401 }
    );
  }
  if (!can(session.roles, "user:read")) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Role Anda tidak boleh melihat daftar user." },
      { status: 403 }
    );
  }

  const users = await listUsers();
  return NextResponse.json({
    ok: true,
    total: users.length,
    items: users.map(toPublicUser),
  });
}

export async function PATCH(request: Request) {
  const session = currentSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHENTICATED", message: "Belum masuk." },
      { status: 401 }
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

  const id = String(body.id ?? "").trim();
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "MISSING_ID", message: "Field id wajib diisi." },
      { status: 400 }
    );
  }

  if (id === session.uid) {
    return NextResponse.json(
      {
        ok: false,
        error: "SELF_EDIT_BLOCKED",
        message: "Tidak boleh mengubah status/role akun sendiri.",
      },
      { status: 409 }
    );
  }

  if (body.status !== undefined) {
    if (!can(session.roles, "user:update")) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "Butuh izin user:update." },
        { status: 403 }
      );
    }
    const status = String(body.status).toUpperCase() as UserStatus;
    if (!["ACTIVE", "PENDING", "SUSPENDED"].includes(status)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS", message: "Status tidak dikenal." },
        { status: 400 }
      );
    }
    const ok = await setUserStatus(id, status);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "User tidak ditemukan." },
        { status: 404 }
      );
    }
  }

  if (body.roles !== undefined) {
    if (!can(session.roles, "user:assign_role")) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "Butuh izin user:assign_role." },
        { status: 403 }
      );
    }
    const raw = Array.isArray(body.roles) ? body.roles : [body.roles];
    const roles = raw.map((r) => String(r).toUpperCase()).filter(isRole) as Role[];
    if (roles.length === 0) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ROLES", message: "Role tidak dikenal." },
        { status: 400 }
      );
    }
    const ok = await setUserRoles(id, roles);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "User tidak ditemukan." },
        { status: 404 }
      );
    }
  }

  const users = await listUsers();
  const updated = users.find((u) => u.id === id);
  return NextResponse.json({
    ok: true,
    user: updated ? toPublicUser(updated) : null,
  });
}
