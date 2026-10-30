import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/guard";
import { effectivePermissions, ROLE_DEFS } from "@/lib/auth/rbac";
import { storeBackend } from "@/lib/auth/store";

/**
 * GET /api/auth/me
 *
 * Mengembalikan sesi aktif beserta permission efektif dan definisi role-nya.
 * Dipakai UI untuk menyembunyikan menu yang tidak boleh diakses — tapi
 * keputusan akhir tetap di server (setiap route memanggil requirePermission).
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

  return NextResponse.json({
    ok: true,
    user: {
      uid: session.uid,
      email: session.email,
      name: session.name,
      roles: session.roles,
      primaryRole: session.primaryRole,
      status: session.status,
    },
    roleDefinition: ROLE_DEFS[session.primaryRole] ?? null,
    permissions: effectivePermissions(session.roles),
    store: storeBackend(),
    expiresAt: session.exp * 1000,
  });
}
