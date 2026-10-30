"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Form masuk. Setelah sukses, diarahkan sesuai role (admin → /admin, customer → /akun). */

const DEMO_ACCOUNTS = [
  { email: "superadmin@octarine.test", password: "Super#2026", role: "Super Admin" },
  { email: "katalog@octarine.test", password: "Katalog#2026", role: "Admin Katalog" },
  { email: "order@octarine.test", password: "Order#2026", role: "Admin Order" },
  { email: "gudang@octarine.test", password: "Gudang#2026", role: "Admin Gudang" },
  { email: "customer@octarine.test", password: "Customer#2026", role: "Customer" },
];

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        redirectTo?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "Gagal masuk.");
        return;
      }
      router.push(data.redirectTo ?? "/akun");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full border border-ink/20 bg-white px-3 py-2 text-sm outline-none focus:border-ink";
  const labelCls = "mb-1 block text-[11px] uppercase tracking-widest2 text-smoke";

  return (
    <div className="mx-auto max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>Email</label>
          <input
            className={inputCls}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="nama@domain.com"
          />
        </div>
        <div>
          <label className={labelCls}>Password</label>
          <input
            className={inputCls}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div className="border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-ink px-4 py-3 text-[12px] uppercase tracking-widest2 text-white transition hover:bg-charcoal disabled:opacity-50"
        >
          {busy ? "Memproses…" : "Masuk"}
        </button>
      </form>

      <p className="mt-6 text-center text-[12px] text-smoke">
        Belum punya akun?{" "}
        <Link href="/register" className="text-ink underline underline-offset-4">
          Daftar
        </Link>
      </p>

      <div className="mt-8 border-t border-ink/10 pt-4">
        <button
          type="button"
          onClick={() => setShowDemo((v) => !v)}
          className="text-[11px] uppercase tracking-widest2 text-smoke hover:text-ink"
        >
          {showDemo ? "Sembunyikan akun contoh" : "Lihat akun contoh (simulasi)"}
        </button>
        {showDemo && (
          <div className="mt-3 space-y-1">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => {
                  setEmail(a.email);
                  setPassword(a.password);
                }}
                className="flex w-full items-center justify-between border border-ink/10 px-3 py-2 text-left text-[11px] hover:bg-bone"
              >
                <span className="text-ink">{a.email}</span>
                <span className="text-smoke">{a.role}</span>
              </button>
            ))}
            <p className="pt-2 text-[10px] leading-relaxed text-smoke">
              Akun seed hanya untuk simulasi akademik. Hapus/ganti sebelum dipakai
              untuk data nyata.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
