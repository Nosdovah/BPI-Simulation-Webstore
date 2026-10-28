"use client";

import type { CartLine } from "./types";

const KEY = "osr_cart_v1";
const CHECKOUT_KEY = "osr_checkout_v1";

export function readCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l) => typeof l?.sku === "string" && Number(l?.qty) > 0)
      .map((l) => ({ sku: l.sku, qty: Math.min(99, Math.floor(Number(l.qty))) }));
  } catch {
    return [];
  }
}

export function writeCart(lines: CartLine[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event("osr-cart-change"));
}

export function addToCart(sku: string, qty = 1): CartLine[] {
  const lines = readCart();
  const found = lines.find((l) => l.sku === sku);
  if (found) found.qty = Math.min(99, found.qty + qty);
  else lines.push({ sku, qty });
  writeCart(lines);
  return lines;
}

export function updateQty(sku: string, qty: number): CartLine[] {
  let lines = readCart();
  if (qty <= 0) lines = lines.filter((l) => l.sku !== sku);
  else lines = lines.map((l) => (l.sku === sku ? { ...l, qty: Math.min(99, qty) } : l));
  writeCart(lines);
  return lines;
}

export function clearCart() {
  writeCart([]);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((a, l) => a + l.qty, 0);
}

/** Idempotency key stabil per percobaan checkout (blueprint §6.4). */
export function checkoutKey(): string {
  if (typeof window === "undefined") return `chk_${Date.now()}`;
  const cart = readCart();
  const signature = cart.map((l) => `${l.sku}x${l.qty}`).join("|");
  const raw = `chk_${signature}`;
  // hash sederhana, cukup untuk satu sesi checkout
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