"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useCart } from "./CartProvider";
import { checkoutKey, readCheckoutDraft, saveCheckoutDraft } from "@/lib/cart";
import { formatIdr, formatNumber } from "@/lib/format";

type Resolved = {
  sku: string;
  found: boolean;
  name?: string;
  priceIdr?: number;
  stockDisplay?: number | null;
  stockError?: string | null;
};

type Draft = {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  courier: string;
  service: string;
};

const COURIERS = [
  { id: "sicepat", label: "SiCepat", services: ["REG", "HALU"], cost: 18000 },
  { id: "jnt", label: "J&T Express", services: ["EZ", "REG"], cost: 16000 },
  { id: "anteraja", label: "AnterAja", services: ["REG"], cost: 15000 },
  { id: "instant", label: "Instant (same day)", services: ["SAME DAY"], cost: 32000 },
];

const EMPTY: Draft = {
  name: "",
  phone: "",
  email: "",
  address: "",
  city: "Bogor",
  postalCode: "16111",
  courier: "sicepat",
  service: "REG",
};

export function CheckoutForm() {
  const { lines, clear, ready } = useCart();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Array<{ sku: string; error: string | null }>>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const saved = readCheckoutDraft<Draft>();
    if (saved) setDraft({ ...EMPTY, ...saved });
  }, []);

  useEffect(() => {
    saveCheckoutDraft(draft);
  }, [draft]);

  const skusKey = lines.map((l) => l.sku).join(",");

  useEffect(() => {
    if (!skusKey) return;
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

  const courier = COURIERS.find((c) => c.id === draft.courier) ?? COURIERS[0];
  const shippingCost = courier.cost;

  const subtotal = useMemo(
    () => lines.reduce((acc, l) => acc + (resolved[l.sku]?.priceIdr ?? 0) * l.qty, 0),
    [lines, resolved],
  );
  const total = subtotal + shippingCost;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConflict([]);

    if (!draft.name.trim() || !draft.phone.trim() || !draft.address.trim()) {
      setError("Nama, nomor telepon, dan alamat wajib diisi.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: "WEBSTORE",
          customer: { name: draft.name, phone: draft.phone, email: draft.email },
          shipping: {
            address: draft.address,
            city: draft.city,
            postalCode: draft.postalCode,
            courier: draft.courier,
            service: draft.service,
            costIdr: shippingCost,
          },
          items: lines.map((l) => ({ sku: l.sku, qty: l.qty })),
          client_ref: `cart_${skusKey.length}`,
          idempotency_key: checkoutKey(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setConflict(
            (data.lines ?? []).filter((l: { ok: boolean }) => !l.ok),
          );
          setError(
            data.error === "COMPOSITION_MISSING"
              ? "Komposisi bundling tidak tersedia — tambahkan komponen di WMS 4.1."
              : "Stok berubah sejak barang masuk keranjang. Konfirmasi ulang jumlahnya.",
          );
        } else {
          setError(data.message ?? "Checkout gagal.");
        }
        return;
      }

      clear();
      const token = encodeURIComponent(data.token as string);
      router.push(`/order/${data.ref}?k=${token}`);
    } catch {
      setError("Jaringan bermasalah. Order tidak digandakan karena idempotency key.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return <p className="py-16 text-center text-xs text-smoke">Memuat…</p>;
  }

  if (lines.length === 0) {
    return (
      <div className="border border-ink/15 bg-bone p-12 text-center">
        <p className="font-display text-3xl">Tidak ada item untuk dibayar</p>
        <Link href="/shop" className="btn-primary mt-6">Kembali ke katalog</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-8">
        <section>
          <h2 className="text-[10px] uppercase tracking-widest2 text-smoke">Data penerima</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">Nama lengkap</label>
              <input
                id="name"
                className="input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Nama penerima"
              />
            </div>
            <div>
              <label className="label" htmlFor="phone">Nomor WhatsApp</label>
              <input
                id="phone"
                className="input"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="+62…"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="email">Email (opsional)</label>
              <input
                id="email"
                className="input"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="nama@example.test"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-[10px] uppercase tracking-widest2 text-smoke">Alamat pengiriman</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="address">Alamat</label>
              <input
                id="address"
                className="input"
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder="Jalan, nomor, kecamatan"
              />
            </div>
            <div>
              <label className="label" htmlFor="city">Kota</label>
              <input
                id="city"
                className="input"
                value={draft.city}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="postal">Kode pos</label>
              <input
                id="postal"
                className="input"
                value={draft.postalCode}
                onChange={(e) => setDraft({ ...draft, postalCode: e.target.value })}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-[10px] uppercase tracking-widest2 text-smoke">Kurir</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {COURIERS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setDraft({ ...draft, courier: c.id, service: c.services[0] })}
                className={`flex items-center justify-between border px-4 py-3 text-left text-xs ${
                  draft.courier === c.id
                    ? "border-ink bg-bone"
                    : "border-ink/15 hover:border-ink/40"
                }`}
              >
                <span>{c.label}</span>
                <span className="text-smoke">{formatIdr(c.cost)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="border border-ink/15 bg-bone p-4">
          <p className="text-[10px] uppercase tracking-widest2 text-smoke">
            Setelah pembayaran
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink/75">
            Pesanan langsung diteruskan ke gudang dan diproses otomatis. Nomor resi
            muncul di halaman pelacakan begitu paket diserahkan ke kurir.
          </p>
        </section>
      </div>

      <aside className="h-fit border border-ink/15 p-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Ringkasan pesanan</p>
        <ul className="mt-4 space-y-3 border-b border-ink/10 pb-4">
          {lines.map((l) => (
            <li key={l.sku} className="flex justify-between gap-3 text-xs">
              <span>
                {resolved[l.sku]?.name ?? l.sku}
                <span className="block text-[10px] text-smoke">
                  {l.qty} × {formatIdr(resolved[l.sku]?.priceIdr ?? 0)}
                </span>
              </span>
              <span>{formatIdr((resolved[l.sku]?.priceIdr ?? 0) * l.qty)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-smoke">Subtotal</span>
            <span>{formatIdr(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-smoke">Ongkir ({courier.label})</span>
            <span>{formatIdr(shippingCost)}</span>
          </div>
          <div className="flex justify-between border-t border-ink/10 pt-2 text-sm">
            <span>Total</span>
            <span>{formatIdr(total)}</span>
          </div>
        </div>

        {error ? (
          <div className="mt-4 border border-alert/40 bg-alert/5 p-3 text-[11px] text-alert">
            <p>{error}</p>
            {conflict.length ? (
              <ul className="mt-2 space-y-1">
                {conflict.map((c) => (
                  <li key={c.sku} className="font-mono text-[10px]">
                    {c.sku} — {c.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <button type="submit" className="btn-primary mt-6 w-full" disabled={submitting}>
          {submitting ? "Memproses…" : `Bayar ${formatIdr(total)}`}
        </button>
        <p className="mt-3 text-[10px] leading-relaxed text-smoke">
          Pembayaran diverifikasi otomatis. Idempotency key aktif:{" "}
          <span className="font-mono">{checkoutKey()}</span> — klik ganda tidak
          menggandakan order.
        </p>
        <Link href="/cart" className="mt-3 block text-center text-[10px] uppercase tracking-widest2 text-smoke underline underline-offset-4">
          Kembali ke keranjang
        </Link>
      </aside>
    </form>
  );
}