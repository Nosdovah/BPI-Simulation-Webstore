"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { REGISTERABLE_ROLES, ROLE_DEFS } from "@/lib/auth/rbac";
import type { Role } from "@/lib/auth/types";

/**
 * Form registrasi storefront.
 *
 * Dua tab:
 *   Customer — terbuka untuk siapa pun, role dikunci CUSTOMER di server.
 *   Admin    — wajib kode undangan. Pilihan role hanya yang ada di ADMIN_ROLES.
 *
 * Validasi di sini hanya untuk kenyamanan; server tetap memvalidasi ulang
 * semuanya (lihat app/api/auth/register/route.ts).
 */

type Mode = "customer" | "admin";

const ROLE_HINT: Record<string, string> = {
  SUPER_ADMIN: "Semua modul + manajemen user",
  ADMIN_KATALOG: "Produk, varian, harga, komposisi bundling",
  ADMIN_ORDER: "Pesanan, transisi status, resi, refund",
  ADMIN_GUDANG: "Stok per gudang, kuota bundle, sinkronisasi",
};

export function RegisterForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("customer");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirm: "",
    role: "ADMIN_KATALOG" as Role,
    inviteCode: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (form.name.trim().length < 2) errs.name = "Nama minimal 2 karakter.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      errs.email = "Format email tidak valid.";
    if (form.password.length < 8) errs.password = "Password minimal 8 karakter.";
    else if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password))
      errs.password = "Password harus memuat huruf dan angka.";
    if (form.password !== form.confirm) errs.confirm = "Konfirmasi password tidak sama.";
    if (mode === "admin" && !form.inviteCode.trim())
      errs.inviteCode = "Kode undangan admin wajib diisi.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          password: form.password,
          role: mode === "admin" ? form.role : undefined,
          inviteCode: mode === "admin" ? form.inviteCode : undefined,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        redirectTo?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "Registrasi gagal.");
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
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex border border-ink/15">
        {(["customer", "admin"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
              setFieldErrors({});
            }}
            className={`flex-1 px-4 py-3 text-[12px] uppercase tracking-widest2 transition ${
              mode === m ? "bg-ink text-white" : "bg-white text-smoke hover:bg-bone"
            }`}
          >
            {m === "customer" ? "Daftar sebagai Customer" : "Daftar sebagai Admin"}
          </button>
        ))}
      </div>

      {mode === "admin" && (
        <div className="mb-5 border-l-2 border-brass bg-bone px-4 py-3 text-[12px] leading-relaxed text-smoke">
          Pendaftaran admin butuh <strong className="text-ink">kode undangan</strong> yang
          hanya diberikan Super Admin. Ini mencegah siapa pun menaikkan dirinya
          sendiri menjadi admin lewat request manual.
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>Nama lengkap</label>
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Nama sesuai identitas"
            autoComplete="name"
          />
          {fieldErrors.name && (
            <p className="mt-1 text-[11px] text-alert">{fieldErrors.name}</p>
          )}
        </div>

        <div>
          <label className={labelCls}>Email</label>
          <input
            className={inputCls}
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="nama@domain.com"
            type="email"
            autoComplete="email"
          />
          {fieldErrors.email && (
            <p className="mt-1 text-[11px] text-alert">{fieldErrors.email}</p>
          )}
        </div>

        <div>
          <label className={labelCls}>Nomor telepon (opsional)</label>
          <input
            className={inputCls}
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="08xxxxxxxxxx"
            autoComplete="tel"
          />
        </div>

        {mode === "admin" && (
          <>
            <div>
              <label className={labelCls}>Role</label>
              <select
                className={inputCls}
                value={form.role}
                onChange={(e) => update("role", e.target.value as Role)}
              >
                {REGISTERABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_DEFS[r].label} — {ROLE_HINT[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Kode undangan admin</label>
              <input
                className={inputCls}
                value={form.inviteCode}
                onChange={(e) => update("inviteCode", e.target.value)}
                placeholder="OSR-ADMIN-…"
              />
              {fieldErrors.inviteCode && (
                <p className="mt-1 text-[11px] text-alert">{fieldErrors.inviteCode}</p>
              )}
            </div>
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Password</label>
            <input
              className={inputCls}
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="Min. 8 karakter"
            />
            {fieldErrors.password && (
              <p className="mt-1 text-[11px] text-alert">{fieldErrors.password}</p>
            )}
          </div>
          <div>
            <label className={labelCls}>Ulangi password</label>
            <input
              className={inputCls}
              value={form.confirm}
              onChange={(e) => update("confirm", e.target.value)}
              type="password"
              autoComplete="new-password"
            />
            {fieldErrors.confirm && (
              <p className="mt-1 text-[11px] text-alert">{fieldErrors.confirm}</p>
            )}
          </div>
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
          {busy ? "Memproses…" : mode === "admin" ? "Daftar sebagai Admin" : "Buat Akun"}
        </button>
      </form>

      <p className="mt-6 text-center text-[12px] text-smoke">
        Sudah punya akun?{" "}
        <Link href="/login" className="text-ink underline underline-offset-4">
          Masuk di sini
        </Link>
      </p>
    </div>
  );
}
