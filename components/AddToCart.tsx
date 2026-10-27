"use client";

import { useState } from "react";
import { useCart } from "./CartProvider";

export function AddToCart({
  sku,
  disabled,
  disabledReason,
  maxQty,
}: {
  sku: string;
  disabled?: boolean;
  disabledReason?: string | null;
  maxQty?: number | null;
}) {
  const { add } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const limit = typeof maxQty === "number" ? Math.max(0, maxQty) : 99;
  const blocked = Boolean(disabled) || limit <= 0;

  function handleAdd() {
    if (blocked) return;
    add(sku, qty);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 2200);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-stretch gap-2">
        <div className="flex items-center border border-ink/20">
          <button
            type="button"
            className="px-3 py-2 text-sm text-smoke hover:text-ink disabled:opacity-40"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={blocked}
            aria-label="Kurangi jumlah"
          >
            −
          </button>
          <span className="w-8 text-center text-sm">{qty}</span>
          <button
            type="button"
            className="px-3 py-2 text-sm text-smoke hover:text-ink disabled:opacity-40"
            onClick={() => setQty((q) => Math.min(limit, q + 1))}
            disabled={blocked}
            aria-label="Tambah jumlah"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={blocked}
          className="btn-primary flex-1"
        >
          {blocked ? (disabledReason ?? "Habis") : added ? "Ditambahkan ✓" : "Tambah ke keranjang"}
        </button>
      </div>
      {!blocked && typeof maxQty === "number" && maxQty < 99 ? (
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">
          Maksimal {maxQty} unit per transaksi
        </p>
      ) : null}
    </div>
  );
}