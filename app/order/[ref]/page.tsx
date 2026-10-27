import Link from "next/link";
import { notFound } from "next/navigation";
import { deriveStatus, readOrderToken, recallOrder } from "@/lib/orders";
import { formatIdr, formatDateTime } from "@/lib/format";
import { StatusTimeline } from "@/components/StatusTimeline";

export const dynamic = "force-dynamic";

export default function OrderPage({
  params,
  searchParams,
}: {
  params: { ref: string };
  searchParams: { k?: string };
}) {
  const token = searchParams.k;
  const order = recallOrder(params.ref) ?? readOrderToken(token ? decodeURIComponent(token) : null);
  if (!order) notFound();

  const derived = deriveStatus(order);

  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">
          Order {order.mode === "tobe" ? "terkirim ke WMS 4.2" : "masuk dengan payload kosong"}
        </p>
        <h1 className="mt-2 font-display text-4xl">
          {order.mode === "tobe" ? "Pesanan diterima" : "Pesanan tercatat, status belum tersinkron"}
        </h1>
        <p className="mt-2 font-mono text-xs text-smoke">{order.ref}</p>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="border border-ink/15 p-6">
            <StatusTimeline
              token={token ? decodeURIComponent(token) : undefined}
              initial={{
                ref: order.ref,
                mode: order.mode,
                status: derived.status,
                stuck: derived.stuck,
                note: derived.note,
                trackingNo: derived.trackingNo,
                actorLast: order.actorLast,
                timeline: derived.timeline,
              }}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/order/${order.ref}/track${token ? `?k=${encodeURIComponent(decodeURIComponent(token))}` : ""}`}
              className="btn-primary"
            >
              Halaman pelacakan
            </Link>
            <Link href="/shop" className="btn-ghost">Lanjut belanja</Link>
          </div>
        </div>

        <aside className="space-y-6">
          <section className="border border-ink/15 p-6">
            <p className="text-[10px] uppercase tracking-widest2 text-smoke">Ringkasan</p>
            <ul className="mt-3 space-y-3 text-xs">
              {order.items.map((item) => (
                <li key={item.sku} className="flex justify-between gap-3">
                  <span>
                    {item.name}
                    <span className="block text-[10px] text-smoke">
                      {item.qty} × {formatIdr(item.priceIdr)}
                    </span>
                  </span>
                  <span>{formatIdr(item.priceIdr * item.qty)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-2 border-t border-ink/10 pt-3 text-xs">
              <div className="flex justify-between">
                <span className="text-smoke">Subtotal</span>
                <span>{formatIdr(order.subtotalIdr)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-smoke">Ongkir</span>
                <span>{formatIdr(order.shipping.costIdr)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Total</span>
                <span>{formatIdr(order.totalIdr)}</span>
              </div>
            </div>
          </section>

          <section className="border border-ink/15 p-6 text-xs">
            <p className="text-[10px] uppercase tracking-widest2 text-smoke">Pengiriman</p>
            <p className="mt-2">{order.customer.name}</p>
            <p className="text-smoke">{order.customer.phone}</p>
            <p className="mt-2 text-smoke">{order.shipping.address}</p>
            <p className="text-smoke">
              {order.shipping.city} {order.shipping.postalCode}
            </p>
            <p className="mt-2 text-smoke">
              {order.shipping.courier.toUpperCase()} · {order.shipping.service}
            </p>
            <p className="mt-3 font-mono text-[10px] text-smoke">
              dibuat {formatDateTime(order.createdAt)}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}