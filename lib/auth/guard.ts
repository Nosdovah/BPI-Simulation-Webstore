import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE, type SessionInput } from "./session";
import { can, isAdminRole } from "./rbac";
import type { Permission, Role, SessionPayload } from "./types";

/** Ambil sesi aktif dari cookie (server component / route handler). */
export function currentSession(): SessionPayload | null {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  return readSession(raw);
}

/** Sesi yang sudah dipastikan ada. */
export function requireSession(): SessionPayload {
  const s = currentSession();
  if (!s) throw new UnauthorizedError("Belum masuk.");
  return s;
}

export function requirePermission(permission: Permission): SessionPayload {
  const s = requireSession();
  if (!can(s.roles, permission)) {
    throw new ForbiddenError(`Role ${s.primaryRole} tidak punya izin ${permission}.`);
  }
  return s;
}

export function sessionCan(session: SessionPayload | null, permission: Permission): boolean {
  return can(session?.roles ?? null, permission);
}

export function sessionIsAdmin(session: SessionPayload | null): boolean {
  if (!session) return false;
  return session.roles.some(isAdminRole);
}

export type { SessionInput };
export type { Role };

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}
