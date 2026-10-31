import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { currentSession } from "./auth/guard";

/**
 * Pemilik keranjang: pengguna yang sudah masuk, atau tamu.
 *
 * Aturan toko (disamakan dengan octarine.co.id): tamu BOLEH memasukkan barang
 * ke keranjang dan mengubah jumlahnya, tetapi WAJIB masuk saat checkout.
 * Konsekuensinya keranjang tamu tetap harus hidup di server — bukan
 * localStorage — supaya isinya selamat saat pengguna pindah halaman, pindah
 * tab, atau pindah instance serverless.
 *
 * Identitas tamu = cookie `osr_guest` berisi UUID v4 yang DITANDATANGANI HMAC.
 * Tanda tangan penting: tanpa itu, siapa pun yang tahu/menebak sebuah id bisa
 * membaca dan mengubah keranjang milik orang lain hanya dengan menempelkan
 * cookie buatan sendiri.
 *
 * Bentuk `owner_id` di database:
 *   <uid sesi>            → milik pengguna (kompatibel dengan data lama)
 *   guest:<uuid>          → milik tamu
 *
 * Pemisahan awalan ini yang mencegah tabrakan id dan membuat pembersihan
 * keranjang tamu (kedaluwarsa 30 hari) bisa dilakukan tanpa menyentuh
 * keranjang pengguna.
 */

export const GUEST_COOKIE = "osr_guest";
export const GUEST_PREFIX = "guest:";
const GUEST_MAX_AGE = 30 * 24 * 60 * 60;

function secret(): string {
  return (
    process.env.OSR_SESSION_SECRET?.trim() ||
    process.env.OSR_ORDER_SECRET?.trim() ||
    "osr-store-dev-session-secret-2026"
  );
}

function mac(value: string): string {
  return createHmac("sha256", secret()).update(`guest-cart:${value}`).digest("base64url");
}

/** `uuid.signature` — nilai yang disimpan di cookie. */
export function packGuestId(id: string): string {
  return `${id}.${mac(id)}`;
}

/** Kembalikan id tamu hanya kalau tanda tangannya sah. */
export function unpackGuestId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const expected = mac(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

/** Baca id tamu dari cookie tanpa membuat yang baru. */
export function readGuestId(): string | null {
  return unpackGuestId(cookies().get(GUEST_COOKIE)?.value);
}

function writeGuestCookie(id: string): void {
  cookies().set({
    name: GUEST_COOKIE,
    value: packGuestId(id),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_MAX_AGE,
  });
}

/** Hapus cookie tamu (dipanggil setelah keranjangnya digabung ke akun). */
export function clearGuestCookie(): void {
  cookies().set({
    name: GUEST_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export type CartOwner = {
  /** Nilai yang dipakai sebagai `owner_id` di database. "" bila tamu tanpa cookie. */
  owner: string;
  kind: "user" | "guest";
  uid: string | null;
  guestId: string | null;
};

/**
 * Tentukan pemilik keranjang untuk request ini.
 *
 * `create: true` hanya dipakai pada operasi TULIS. Operasi baca tidak boleh
 * menerbitkan cookie — pengunjung yang cuma melihat-lihat tidak perlu
 * meninggalkan jejak di database.
 *
 * Catatan: fungsi ini menulis cookie, jadi hanya boleh dipanggil dari Route
 * Handler atau Server Action, bukan dari Server Component biasa.
 */
export function resolveCartOwner(options: { create?: boolean } = {}): CartOwner {
  const session = currentSession();

  if (session) {
    return {
      owner: session.uid,
      kind: "user",
      uid: session.uid,
      guestId: readGuestId(),
    };
  }

  const existing = readGuestId();
  if (existing) {
    return { owner: `${GUEST_PREFIX}${existing}`, kind: "guest", uid: null, guestId: existing };
  }

  if (options.create) {
    const id = randomUUID();
    writeGuestCookie(id);
    return { owner: `${GUEST_PREFIX}${id}`, kind: "guest", uid: null, guestId: id };
  }

  return { owner: "", kind: "guest", uid: null, guestId: null };
}
