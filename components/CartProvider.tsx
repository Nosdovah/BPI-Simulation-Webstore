"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { CartLine } from "@/lib/types";
import { addToCart, cartCount, clearCart, readCart, updateQty, writeCart } from "@/lib/cart";

type CartContextValue = {
  lines: CartLine[];
  count: number;
  ready: boolean;
  add: (sku: string, qty?: number) => void;
  setQty: (sku: string, qty: number) => void;
  remove: (sku: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLines(readCart());
    setReady(true);
    const sync = () => setLines(readCart());
    window.addEventListener("osr-cart-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("osr-cart-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const add = useCallback((sku: string, qty = 1) => setLines(addToCart(sku, qty)), []);
  const setQty = useCallback((sku: string, qty: number) => setLines(updateQty(sku, qty)), []);
  const remove = useCallback(
    (sku: string) => setLines(readCart().filter((l) => l.sku !== sku)),
    [],
  );
  const clear = useCallback(() => {
    clearCart();
    setLines([]);
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({ lines, count: cartCount(lines), ready, add, setQty, remove, clear }),
    [lines, ready, add, setQty, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart harus dipakai di dalam CartProvider");
  return ctx;
}

export { writeCart };