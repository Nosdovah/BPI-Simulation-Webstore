import Link from "next/link";
import { notFound } from "next/navigation";
import { deriveStatus, readOrderToken, recallOrder } from "@/lib/orders";
import { StatusTimeline } from "@/components/StatusTimeline";

export const dynamic = "force-dynamic";

export default function TrackPage({
  params,
  searchParams,
}: {
  params: { ref: string };
  searchParams: { k?: string };
}) {
  const token = searchParams.k ? decodeURIComponent(searchParams.k) : undefined;
  const order = recallOrder(params.ref) ?? readOrderToken(token);
  if (!order) notFound();

  const derived = deriveStatus(order);

  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Lacak pesanan</p>
        <h1 className="mt-2 font-display text-4xl">{order.ref}</h1>
        <p className="mt-2 text-xs text-smoke">
          Timeline diperbarui otomatis. Halaman ini menyegarkan status setiap beberapa detik.
        </p>
      </div>

      <div className="mt-8 max-w-2xl border border-ink/15 p-6">
        <StatusTimeline
          token={token}
          initial={{
            ref: order.ref,
            status: derived.status,
            note: derived.note,
            trackingNo: derived.trackingNo,
            actorLast: order.actorLast,
            timeline: derived.timeline,
          }}
        />
      </div>

      <div className="mt-6 flex gap-3">
        <Link href={`/order/${order.ref}${token ? `?k=${encodeURIComponent(token)}` : ""}`} className="btn-ghost">
          Kembali ke ringkasan
        </Link>
        <Link href="/lacak-pesanan" className="btn-ghost">Lacak nomor lain</Link>
      </div>
    </div>
  );
}