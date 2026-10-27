"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SimControls({ initialQty = 500 }: { initialQty?: number }) {
  const router = useRouter();
  const [qty, setQty] = useState(initialQty);
  const [material, setMaterial] = useState("M2292");
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMessage(null);
    try {
      const res = await fetch("/api/sim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Gagal");
        return;
      }
      setMessage(
        body.action === "reset"
          ? "Penjualan sesi direset."
          : `${qty} unit ${material} tercatat terjual.`,
      );
      startTransition(() => router.refresh());
    } catch {
      setMessage("Jaringan bermasalah.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border border-ink/15 p-5">
      <p className="text-[10px] uppercase tracking-widest2 text-smoke">Kontrol simulasi</p>
      <p className="mt-2 text-[11px] leading-relaxed text-ink/75">
        Jual komponen untuk membuktikan cacat kuota statis: di mode <strong>baseline</strong>{" "}
        angka bundle tidak berubah, di mode <strong>to-be</strong> angka langsung turun.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="material">Material</label>
          <select
            id="material"
            className="input"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
          >
            <option value="M2292">M2292 — Noctis Obscura 20ml (10.932)</option>
            <option value="M2291">M2291 — Sanctum Arcanum 20ml (11.927)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="qty">Jumlah unit</label>
          <input
            id="qty"
            type="number"
            min={1}
            max={100000}
            className="input"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => post({ action: "sell", materialCode: material, qty }, "sell")}
            disabled={busy !== null || pending}
          >
            {busy === "sell" ? "Memproses…" : "Jual komponen"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => post({ action: "reset" }, "reset")}
          disabled={busy !== null || pending}
        >
          {busy === "reset" ? "Mereset…" : "Reset penjualan sesi"}
        </button>
        <span className="text-[10px] uppercase tracking-widest2 text-smoke">
          State in-memory — hilang saat server restart
        </span>
      </div>

      {message ? <p className="mt-3 text-[11px] text-ink/70">{message}</p> : null}
    </div>
  );
}