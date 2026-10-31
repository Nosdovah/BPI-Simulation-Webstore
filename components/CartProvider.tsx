"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CartLine } from "@/lib/types";
import { cartCount, checkoutKey } from "@/lib/cart";

/**
 * Keranjang storefront — sumber kebenaran ada di SERVER (/api/cart).
 *
 * Provider ini tidak pernah menyimpan isi keranjang di localStorage. Yang
 * dipegang hanya salinan tampilan (state React) yang selalu ditimpa hasil
 * respons server. Konsekuensinya: dua perangkat, dua tab, dan dua instance
 * serverless melihat isi yang sama.
 *
 * Tamu BOLEH memakai keranjang. Server menandai pemiliknya sendiri lewat
 * cookie `osr_guest` (bertanda tangan), jadi tidak ada satu pun id pemilik
 * yang dikirim dari sini — kalau ada, itu berarti kebocoran.
 *
 * `AUTH_REQUIRED` hanya muncul saat checkout (POST /api/orders). Di titik itu
 * pemanggil yang mengarahkan pengguna ke /login dengan `?next=`, bukan provider.
 */

export type CartActionResult =
  | { ok: true; lines: CartLine[] }
  | { ok: false; error: "AUTH_REQUIRED" | "STOCK_INSUFFICIENT" | "BACKEND" | "UNKNOWN"; message: string };

type CartContextValue = {
  lines: CartLine[];
  count: number;
  subtotalIdr: number;
  ready: boolean;
  busy: boolean;
  backend: string | null;
  guest: boolean;
  lastError: string | null;
  add: (sku: string, qty?: number) => Promise<CartActionResult>;
  setQty: (sku: string, qty: number) => Promise<CartActionResult>;
  remove: (sku: string) => Promise<CartActionResult>;
  clear: () => Promise<CartActionResult>;
  refresh: () => Promise<void>;
};

type ApiPayload = {
  ok?: boolean;
  backend?: string;
  guest?: boolean;
  lines?: CartLine[];
  subtotalIdr?: number;
  error?: string;
  message?: string;
};

const CartContext = createContext<CartContextValue | null>(null);

async function callCart(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<{ status: number; data: ApiPayload }> {
  const res = await fetch("/api/cart", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as ApiPayload;
  return { status: res.status, data };
}

function toResult(status: number, data: ApiPayload): CartActionResult {
  if (status === 401) {
    return { ok: false, error: "AUTH_REQUIRED", message: data.message ?? "Masuk dulu untuk memakai keranjang." };
  }
  if (status === 409) {
    return { ok: false, error: "STOCK_INSUFFICIENT", message: data.message ?? "Stok tidak mencukupi." };
  }
  if (status >= 500) {
    return { ok: false, error: "BACKEND", message: data.message ?? "Keranjang sedang tidak tersedia." };
  }
  if (!data.lines) {
    return { ok: false, error: "UNKNOWN", message: data.message ?? "Permintaan keranjang gagal." };
  }
  return { ok: true, lines: data.lines };
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [subtotalIdr, setSubtotalIdr] = useState(0);
  const [backend, setBackend] = useState<string | null>(null);
  const [guest, setGuest] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const inflight = useRef(false);

  const apply = useCallback((data: ApiPayload) => {
    if (Array.isArray(data.lines)) setLines(data.lines);
    if (typeof data.subtotalIdr === "number") setSubtotalIdr(data.subtotalIdr);
    if (typeof data.backend === "string") setBackend(data.backend);
    if (typeof data.guest === "boolean") setGuest(data.guest);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { status, data } = await callCart("GET");
      if (status === 401) {
        setLines([]);
        setSubtotalIdr(0);
        return;
      }
      if (status === 200) apply(data);
    } catch {
      // jaringan putus — biarkan state lama
    } finally {
      setReady(true);
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sinkron ulang saat tab kembali aktif: dua tab tidak boleh berbeda isi.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const run = useCallback(
    async (
      method: "POST" | "PATCH" | "DELETE",
      body?: unknown,
      query = "",
    ): Promise<CartActionResult> => {
      if (inflight.current) {
        return { ok: false, error: "UNKNOWN", message: "Permintaan sebelumnya belum selesai." };
      }
      inflight.current = true;
      setBusy(true);
      try {
        const res = await fetch(`/api/cart${query}`, {
          method,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          cache: "no-store",
          credentials: "same-origin",
        });
        const data = (await res.json().catch(() => ({}))) as ApiPayload;
        const result = toResult(res.status, data);

        if (result.ok) {
          apply(data);
          setLastError(null);
        } else {
          // Tidak ada auto-redirect: tamu memang boleh menambah barang.
          // Pengalihan ke /login hanya terjadi di checkout.
          setLastError(result.message);
        }
        return result;
      } catch {
        const message = "Keranjang tidak bisa dihubungi. Periksa koneksi.";
        setLastError(message);
        return { ok: false, error: "BACKEND", message };
      } finally {
        inflight.current = false;
        setBusy(false);
      }
    },
    [apply],
  );

  const add = useCallback((sku: string, qty = 1) => run("POST", { sku, qty }), [run]);
  const setQty = useCallback((sku: string, qty: number) => run("PATCH", { sku, qty }), [run]);
  const remove = useCallback((sku: string) => run("DELETE", undefined, `?sku=${encodeURIComponent(sku)}`), [run]);
  const clear = useCallback(() => run("DELETE"), [run]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      count: cartCount(lines),
      subtotalIdr,
      ready,
      busy,
      backend,
      guest,
      lastError,
      add,
      setQty,
      remove,
      clear,
      refresh,
    }),
    [lines, subtotalIdr, ready, busy, backend, guest, lastError, add, setQty, remove, clear, refresh],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart harus dipakai di dalam CartProvider");
  return ctx;
}

export { checkoutKey };