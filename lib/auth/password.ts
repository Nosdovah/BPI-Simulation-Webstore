import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hash password memakai scrypt bawaan Node — tanpa dependensi eksternal
 * (bcrypt/argon2 butuh kompilasi native, merepotkan di serverless).
 *
 * Format penyimpanan: salt hex 16 byte + hash hex 64 byte, dipisah kolom
 * tersendiri di record user.
 */

const KEYLEN = 64;
const SALT_BYTES = 16;

export type HashedPassword = { hash: string; salt: string };

export function hashPassword(plain: string): HashedPassword {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const hash = scryptSync(plain, salt, KEYLEN).toString("hex");
  return { hash, salt };
}

export function verifyPassword(plain: string, stored: HashedPassword): boolean {
  try {
    const expected = Buffer.from(stored.hash, "hex");
    const actual = scryptSync(plain, stored.salt, KEYLEN);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Aturan password minimum. Sengaja tidak terlalu ketat supaya demo tetap
 * nyaman, tapi cukup untuk mencegah input kosong / tebakan sepele.
 */
export function validatePassword(plain: string): string | null {
  if (typeof plain !== "string" || plain.length < 8) {
    return "Password minimal 8 karakter.";
  }
  if (plain.length > 200) return "Password maksimal 200 karakter.";
  if (!/[A-Za-z]/.test(plain)) return "Password harus memuat huruf.";
  if (!/[0-9]/.test(plain)) return "Password harus memuat angka.";
  return null;
}

export function validateEmail(email: string): string | null {
  const trimmed = (email ?? "").trim();
  if (!trimmed) return "Email wajib diisi.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Format email tidak valid.";
  if (trimmed.length > 190) return "Email terlalu panjang.";
  return null;
}
