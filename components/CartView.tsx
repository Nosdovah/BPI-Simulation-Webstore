"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCart } from "./CartProvider";
import { formatIdr, formatNumber } from "@/lib/format";

type Resolved = {
  sku: string;
  found: boolean;
  name?: string;
  priceIdr?: number;
  imageKey?: string;
  isBundle?: boolean;
  sizeLabel?: string;
  stockDisplay?: number | null;
  stockError?: string | null;
  stockLabel?: string | null;
};

export function CartView({ mode }: { mode: "baseline" | "tobe" }) {
  const { lines, setQty, remove, ready } = useCart();
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});
  const [loading, setLoading] = useState(false);

  const skusKey = lines.map((l) => l.sku).join(",");

  useEffect(() => {
    if (!skusKey) {
      setResolved({});
      return;
    }
    let alive = true;
    setLoading(true);
    fetch(`/api/catalog/stock?skus=${encodeURIComponent(skusKey)}`)
      .then((r) => r.json())
      .then((data: { items: Resolved[] }) => {
        if (!alive) return;
        const map: Record<string, Resolved> = {};
        for (const item of data.items) map[item.sku] = item;
        setResolved(map);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [skusKey]);

  const subtotal = useMemo(
    () =>
      lines.reduce((acc, l) => {
        const item = resolved[l.sku];
        return acc + (item?.priceIdr ?? 0) * l.qty;
      }, 0),
    [lines, resolved],
  );

  const problems = lines.filter((l) => {
    const item = resolved[l.sku];
    if (!item) return false;
    if (item.stockError) return true;
    return (item.stockDisplay ?? 0) < l.qty;
  });

  if (!ready) {
    return <p className="py-16 text-center text-xs text-smoke">Memuat keranjang…</p>;
  }

  if (lines.length === 0) {
    return (
      <div className="border border-ink/15 bg-bone p-12 text-center">
        <p className="font-display text-3xl">Keranjang masih kosong</p>
        <p className="mt-2 text-xs text-smoke">
          Tambahkan parfum dari katalog untuk mencoba alur checkout.
        </p>
        <Link href="/shop" className="btn-primary mt-6">Mulai belanja</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.6fr_1fr]">
      <div>
        <div className="border-t border-ink/10">
          {lines.map((line) => {
            const item = resolved[line.sku];
            const overStock =
              item && !item.stockError && (item.stockDisplay ?? 0) < line.qty;
            return (
              <div
                key={line.sku}
                className="flex gap-4 border-b border-ink/10 py-4"
              >
                <div className="h-24 w-20 shrink-0 bg-mist" />
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest2 text-smoke">
                        {item?.isBundle ? "Bundling" : item?.sizeLabel ?? "—"}
                      </p>
                      <p className="mt-1 text-sm">
                        {item?.name ?? line.sku}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-smoke">{line.sku}</p>
                    </div>
                    <p className="text-sm">{formatIdr((item?.priceIdr ?? 0) * line.qty)}</p>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex items-center border border-ink/20">
                      <button
                        className="px-2 py-1 text-sm text-smoke hover:text-ink"
                        onClick={() => setQty(line.sku, line.qty - 1)}
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-xs">{line.qty}</span>
                      <button
                        className="px-2 py-1 text-sm text-smoke hover:text-ink"
                        onClick={() => setQty(line.sku, line.qty + 1)}
                      >
                        +
                      </button>
                    </div>
                    <button
                      className="text-[10px] uppercase tracking-widest2 text-smoke underline underline-offset-4 hover:text-ink"
                      onClick={() => remove(line.sku)}
                    >
                      Hapus
                    </button>
                    {item ? (
                      <span className="text-[10px] text-smoke">
                        stok: {item.stockError ? "—" : formatNumber(item.stockDisplay ?? 0)}
                      </span>
                    ) : null}
                  </div>

                  {overStock ? (
                    <p className="mt-2 text-[11px] text-alert">
                      Jumlah melebihi stok tersedia ({formatNumber(item?.stockDisplay ?? 0)}).
                    </p>
                  ) : null}
                  {item?.stockError ? (
                    <p className="mt-2 text-[11px] text-alert">{item.stockError}</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {loading ? (
          <p className="mt-3 text-[10px] uppercase tracking-widest2 text-smoke">
            Memvalidasi stok ke core…
          </p>
        ) : null}
      </div>

      <aside className="h-fit border border-ink/15 bg-bone p-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Ringkasan</p>
        <div className="mt-4 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-smoke">Subtotal</span>
            <span>{formatIdr(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-smoke">Ongkir</span>
            <span className="text-smoke">dihitung saat checkout</span>
          </div>
          <div className="flex justify-between border-t border-ink/10 pt-2 text-sm">
            <span>Total estimasi</span>
            <span>{formatIdr(subtotal)}</span>
          </div>
        </div>

        <p className="mt-4 text-[10px] leading-relaxed text-smoke">
          Mode <strong>{mode}</strong>:{" "}
          {mode === "baseline"
            ? "stok tidak dihitung ulang, jadi keranjang bisa lolos walau komponen sudah habis."
            : "stok divalidasi ulang di core saat checkout; kalau berubah, order ditolak dengan kode STOCK_CHANGED."}
        </p>

        <Link
          href="/checkout"
          className={`btn-primary mt-6 w-full ${problems.length ? "pointer-events-none opacity-50" : ""}`}
        >
          Lanjut ke checkout
        </Link>

        {problems.length ? (
          <p className="mt-3 text-[11px] text-alert">
            Ada {problems.length} baris bermasalah. Perbaiki jumlah dulu.
          </p>
        ) : null}
      </aside>
    </div>
  );
}