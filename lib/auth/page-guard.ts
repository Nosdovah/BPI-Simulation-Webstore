import { redirect } from "next/navigation";
import { currentSession } from "./guard";
import { can, isAdminRole } from "./rbac";
import type { Permission, SessionPayload } from "./types";

/**
 * Penjaga halaman (server component).
 *
 * Berbeda dengan `requirePermission()` di guard.ts yang melempar Error,
 * fungsi di sini memakai `redirect()` supaya pengguna mendarat di halaman
 * yang masuk akal — bukan layar error 500.
 *
 * Aturan:
 *   - belum masuk            → /login
 *   - akun tidak ACTIVE      → /login?alasan=…  (cookie lama dibiarkan,
 *                              login berikutnya yang menolak)
 *   - bukan admin ke /admin  → /akun
 *   - admin tanpa permission → /admin?ditolak=<permission>
 */

const DENIED = "/admin?ditolak=";

export function requireSessionPage(): SessionPayload {
  const session = currentSession();
  if (!session) redirect("/login");
  if (session.status !== "ACTIVE") redirect("/login?status=" + session.status.toLowerCase());
  return session;
}

export function requireAdminPage(): SessionPayload {
  const session = requireSessionPage();
  if (!session.roles.some(isAdminRole)) redirect("/akun");
  return session;
}

export function requirePermissionPage(permission: Permission): SessionPayload {
  const session = requireAdminPage();
  if (!can(session.roles, permission)) {
    redirect(DENIED + encodeURIComponent(permission));
  }
  return session;
}

/** Sesi boleh null — dipakai halaman publik yang berubah tampilan kalau masuk. */
export function optionalSession(): SessionPayload | null {
  const session = currentSession();
  if (!session) return null;
  return session.status === "ACTIVE" ? session : null;
}

export function landingFor(session: SessionPayload): string {
  return session.roles.some(isAdminRole) ? "/admin" : "/akun";
}
