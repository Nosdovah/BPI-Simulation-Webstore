"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Form ubah nama & telepon. Email dan role tidak bisa diubah dari sini. */
export function ProfileForm({
  initialName,
  initialPhone,
}: {
  initialName: string;
  initialPhone: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setMessage({ ok: false, text: data.message ?? "Gagal menyimpan." });
        return;
      }
      setMessage({ ok: true, text: "Profil tersimpan." });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Tidak dapat menghubungi server." });
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full border border-ink/20 bg-white px-3 py-2 text-sm outline-none focus:border-ink";
  const labelCls = "mb-1 block text-[11px] uppercase tracking-widest2 text-smoke";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={labelCls}>Nama</label>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Nomor telepon</label>
        <input
          className={inputCls}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="08xxxxxxxxxx"
        />
      </div>

      {message && (
        <p className={`text-[12px] ${message.ok ? "text-ink" : "text-alert"}`}>
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="bg-ink px-5 py-2 text-[11px] uppercase tracking-widest2 text-white transition hover:bg-charcoal disabled:opacity-50"
      >
        {busy ? "Menyimpan…" : "Simpan perubahan"}
      </button>
    </form>
  );
}
