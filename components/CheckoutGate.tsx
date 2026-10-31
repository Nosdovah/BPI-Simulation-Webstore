"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "./CartProvider";
import { formatIdr } from "@/lib/format";

/**
 * Gerbang checkout untuk tamu.
 *
 * Perilaku toko: barang boleh masuk keranjang tanpa masuk akun, tetapi
 * CHECKOUT wajib punya akun. Halaman ini yang menjelaskan hal itu tanpa
 * membuat pengguna kehilangan isi keranjangnya.
 *
 * Kenapa tidak langsung `redirect("/login")`? Karena pengguna berhak melihat
 * apa yang akan dibelinya — dan di layar ini terlihat jelas bahwa isinya masih
 * utuh setelah masuk. itu juga yang membuat tombol "Masuk" terasa masuk akal.
 */

type Resolved = {
  sku: string;
  name?: string;
  priceIdr?: number;
  sizeLabel?: string;
  isBundle?: boolean;
};

export function CheckoutGate() {
  const { lines, ready } = useCart();
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});

  const skusKey = lines.map((l) => l.sku).join(",");

  useEffect(() => {
    if (!skusKey) {
      setResolved({});
      return;
    }
    let alive = true;
    fetch(`/api/catalog/stock?skus=${encodeURIComponent(skusKey)}`)
      .then((r) => r.json())
      .then((data: { items: Resolved[] }) => {
        if (!alive) return;
        const map: Record<string, Resolved> = {};
        for (const item of data.items) map[item.sku] = item;
        setResolved(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [skusKey]);

  const subtotal = lines.reduce(
    (acc, l) => acc + (resolved[l.sku]?.priceIdr ?? 0) * l.qty,
    0,
  );
  const count = lines.reduce((acc, l) => acc + l.qty, 0);

  return (
    <div className="py-10">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr]">
        {/* ---------------------------------------------------------- kiri --- */}
        <div>
          <div className="bg-mist px-4 py-2 text-[13px] text-smoke">
            Bagaimana kamu ingin melanjutkan?
          </div>

          <div className="mt-4 border border-ink/15 p-6">
            <p className="font-display text-[22px] leading-tight">Masuk ke akun</p>
            <p className="mt-2 text-[13px] leading-relaxed text-smoke">
              Pesanan tersimpan di akun, lebih mudah dicek nanti.
            </p>
            <Link
              href="/login?next=%2Fcheckout&reason=cart"
              className="btn-primary mt-6 w-full text-center"
            >
              Masuk
            </Link>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-smoke">
            Belum punya akun?{" "}
            <Link
              href="/register?next=%2Fcheckout"
              className="text-ink underline underline-offset-4"
            >
              Daftar
            </Link>{" "}
            — keranjangmu ikut pindah setelah masuk.
          </p>

          <p className="mt-6 text-[11px] leading-relaxed text-smoke">
            Kenapa perlu akun? Supaya nomor pesanan, resi, dan riwayat pembelian
            menempel pada satu pemilik. Isi keranjang tidak hilang saat kamu
            masuk — barangnya digabung ke akun.
          </p>
        </div>

        {/* --------------------------------------------------------- kanan --- */}
        <div>
          <h1 className="font-display text-[28px] leading-tight">Shopping Cart</h1>

          {!ready ? (
            <p className="mt-6 text-xs text-smoke">Memuat keranjang…</p>
          ) : lines.length === 0 ? (
            <div className="mt-6 border border-ink/15 bg-bone p-8 text-center">
              <p className="font-display text-2xl">Keranjang masih kosong</p>
              <p className="mt-2 text-xs text-smoke">
                Pilih parfum dulu, lalu kembali ke sini untuk checkout.
              </p>
              <Link href="/shop" className="btn-primary mt-5">
                Mulai belanja
              </Link>
            </div>
          ) : (
            <>
              <div className="mt-5 border-t border-ink/10">
                {lines.map((line) => {
                  const item = resolved[line.sku];
                  return (
                    <div
                      key={line.sku}
                      className="flex items-start gap-4 border-b border-ink/10 py-4"
                    >
                      <div className="h-16 w-16 shrink-0 bg-mist" />
                      <div className="flex-1">
                        <p className="text-sm">{item?.name ?? line.sku}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-widest2 text-smoke">
                          {item?.isBundle ? "Bundling" : item?.sizeLabel ?? "—"}
                        </p>
                        <Link
                          href="/cart"
                          className="mt-2 inline-block text-[10px] uppercase tracking-widest2 text-smoke underline underline-offset-4 hover:text-ink"
                        >
                          Ubah di keranjang
                        </Link>
                      </div>
                      <p className="whitespace-nowrap text-sm">
                        {line.qty} × {formatIdr(item?.priceIdr ?? 0)}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex justify-between text-sm">
                <span className="text-smoke">Subtotal ({count} barang)</span>
                <span>{formatIdr(subtotal)}</span>
              </div>
              <p className="mt-2 text-[11px] text-smoke">
                Ongkir dihitung setelah masuk.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
