import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role, SessionPayload } from "./types";

/**
 * Sesi disimpan di cookie bertanda tangan HMAC (stateless).
 *
 * Kenapa bukan server-side session table? Karena storefront ini berjalan di
 * serverless: instance bisa mati kapan saja. Cookie bertanda tangan membuat
 * sesi tetap valid walau instance berganti — pola yang sama dipakai
 * `lib/orders.ts` untuk token order.
 *
 * Catatan keamanan: cookie ini TIDAK dienkripsi, hanya ditandatangani.
 * Isinya (email, nama, role) bisa dibaca pengguna — karena itu tidak ada
 * rahasia di dalamnya. Yang dijaga adalah integritas: klien tidak bisa
 * menaikkan role-nya sendiri tanpa memalsukan HMAC.
 */

export const SESSION_COOKIE = "osr_session";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function secret(): string {
  return (
    process.env.OSR_SESSION_SECRET?.trim() ||
    process.env.OSR_ORDER_SECRET?.trim() ||
    "osr-store-dev-session-secret-2026"
  );
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function mac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export type SessionInput = {
  uid: string;
  email: string;
  name: string;
  roles: Role[];
  primaryRole: Role;
  status: SessionPayload["status"];
};

export function signSession(input: SessionInput): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    ...input,
    iat: now,
    exp: now + MAX_AGE_SECONDS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${mac(body)}`;
}

export function readSession(token: string | undefined | null): SessionPayload | null {
  if (!token || !token.includes(".")) return null;
  const idx = token.lastIndexOf(".");
  const body = token.slice(0, idx);
  const signature = token.slice(idx + 1);

  const expected = mac(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 < Date.now()) return null;
    if (!payload.uid || !Array.isArray(payload.roles)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = MAX_AGE_SECONDS;
