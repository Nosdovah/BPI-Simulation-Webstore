"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TrackLookupPage() {
  const router = useRouter();
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = ref.trim();
    if (!value) {
      setError("Masukkan nomor pesanan.");
      return;
    }
    router.push(`/order/${encodeURIComponent(value)}`);
  }

  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Lacak pesanan</p>
        <h1 className="mt-2 font-display text-4xl">Cek status pesanan</h1>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-smoke">
          Masukkan nomor pesanan (contoh: ORD-WEBSTORE-PROD-261027-1001). Pada simulasi,
          pesanan hanya bisa dilacak dari perangkat yang membuatnya atau lewat tautan
          bertanda tangan yang diberikan setelah checkout.
        </p>
      </div>

      <form onSubmit={submit} className="mt-8 flex max-w-xl gap-2">
        <input
          className="input"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="ORD-WEBSTORE-PROD-…"
        />
        <button type="submit" className="btn-primary whitespace-nowrap">Lacak</button>
      </form>
      {error ? <p className="mt-3 text-xs text-alert">{error}</p> : null}

      <div className="mt-10 max-w-xl border border-ink/15 bg-bone p-5 text-[11px] leading-relaxed text-ink/75">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Kenapa begini?</p>
        <p className="mt-2">
          Order disimpan sebagai token bertanda tangan di tautan, bukan di database. Ini
          membuat sandbox bisa berjalan tanpa credential Supabase/Vercel. Untuk demo
          multi-perangkat, sambungkan database lewat variabel lingkungan{" "}
          <code className="font-mono">SUPABASE_URL</code> dan{" "}
          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    </div>
  );
}