"use client";

import { useEffect, useState } from "react";

type TimelineEntry = {
  status: string;
  at: number | null;
  done: boolean;
  current: boolean;
  label: string;
};

export type OrderSnapshot = {
  ref: string;
  mode: "baseline" | "tobe";
  status: string;
  stuck: boolean;
  note: string | null;
  trackingNo: string | null;
  actorLast: "SYSTEM" | "STAFF";
  timeline: TimelineEntry[];
};

function timeLabel(ts: number | null) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(ts));
}

export function StatusTimeline({
  initial,
  token,
  compact = false,
}: {
  initial: OrderSnapshot;
  token?: string;
  compact?: boolean;
}) {
  const [snap, setSnap] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch(
          `/api/orders/${snap.ref}${token ? `?k=${encodeURIComponent(token)}` : ""}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as OrderSnapshot;
        setSnap((prev) => ({ ...prev, ...data }));
      } catch {
        /* biarkan, coba lagi tick berikutnya */
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [snap.ref, token, live]);

  async function manualComplete() {
    setBusy(true);
    try {
      await fetch(
        `/api/orders/${snap.ref}/manual${token ? `?k=${encodeURIComponent(token)}` : ""}`,
        { method: "POST" },
      );
      setSnap((prev) => ({
        ...prev,
        status: "COMPLETED",
        stuck: false,
        actorLast: "STAFF",
        note: "Status diubah lewat klik manual staff — bukan hasil sinkronisasi webhook.",
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest2 text-smoke">Status pesanan</p>
          <p className="mt-1 font-mono text-lg">
            {snap.status}
            {snap.stuck ? <span className="ml-2 text-[10px] text-alert">STUCK</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className="border border-ink/20 px-3 py-1.5 text-[10px] uppercase tracking-widest2 text-smoke hover:border-ink hover:text-ink"
          >
            {live ? "Live: on" : "Live: off"}
          </button>
          <span className="text-[10px] uppercase tracking-widest2 text-smoke">
            actor: {snap.actorLast}
          </span>
        </div>
      </div>

      <ol className="mt-6 space-y-0 border-l border-ink/15 pl-0">
        {snap.timeline.map((entry, i) => (
          <li key={`${entry.status}-${i}`} className="relative flex gap-4 pb-4 pl-5">
            <span
              className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${
                entry.done ? "bg-ink" : "border border-ink/30 bg-white"
              }`}
            />
            <div className="flex-1">
              <p
                className={`text-xs ${
                  entry.current ? "font-semibold text-ink" : entry.done ? "text-ink/70" : "text-smoke/60"
                }`}
              >
                {entry.label}
              </p>
              <p className="font-mono text-[10px] text-smoke/70">{timeLabel(entry.at)}</p>
            </div>
          </li>
        ))}
      </ol>

      {snap.trackingNo ? (
        <p className="mt-2 font-mono text-[11px] text-smoke">
          Resi: {snap.trackingNo}
        </p>
      ) : null}

      {snap.note ? (
        <div className="mt-4 border border-alert/30 bg-alert/5 p-3 text-[11px] leading-relaxed text-alert">
          {snap.note}
        </div>
      ) : null}

      {!compact && snap.mode === "baseline" && snap.stuck ? (
        <button
          type="button"
          onClick={manualComplete}
          disabled={busy}
          className="btn-ghost mt-4"
        >
          {busy ? "Memproses…" : "Simulasikan klik manual staff"}
        </button>
      ) : null}
    </div>
  );
}