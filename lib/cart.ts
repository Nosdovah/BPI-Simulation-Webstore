"use client";

import type { CartLine } from "./types";

/**
 * Utilitas keranjang di sisi klien.
 *
 * Isi keranjang TIDAK lagi disimpan di sini. Sejak keranjang pindah ke server
 * (Supabase, `/api/cart`), modul ini hanya menyisakan dua hal yang memang
 * milik peramban:
 *
 *   1. `checkoutKey()` — kunci idempotensi yang stabil untuk satu bentuk
 *      keranjang, supaya klik ganda tidak membuat dua order.
 *   2. draf data pengiriman (`saveCheckoutDraft` / `readCheckoutDraft`) —
 *      agar isian form tidak hilang saat halaman dimuat ulang. Isinya bukan
 *      data dagang, jadi tidak perlu ikut ke server sebelum submit.
 *
 * Yang sengaja TIDAK ada di sini: fungsi baca/tulis localStorage keranjang.
 * Kalau suatu saat muncul lagi `localStorage` berisi daftar SKU, itu tanda
 * keranjang sudah bercabang dua.
 */

const CHECKOUT_KEY = "osr_checkout_v1";

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((a, l) => a + l.qty, 0);
}

/** Idempotency key stabil per bentuk keranjang (blueprint §6.4). */
export function checkoutKey(lines: CartLine[] = []): string {
  const signature = [...lines]
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .map((l) => `${l.sku}x${l.qty}`)
    .join("|");
  const raw = `chk_${signature}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return `chk_${Math.abs(hash).toString(36)}`;
}

export function saveCheckoutDraft(draft: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHECKOUT_KEY, JSON.stringify(draft));
}

export function readCheckoutDraft<T>(): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHECKOUT_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearCheckoutDraft() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CHECKOUT_KEY);
}