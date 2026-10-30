"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Tombol keluar. Menghapus cookie sesi lewat POST /api/auth/logout,
 * lalu mengarahkan ke halaman yang sesuai.
 *
 * `variant="link"` dipakai di header (teks kecil), `variant="solid"`
 * dipakai di kartu profil.
 */
export function LogoutButton({
  variant = "solid",
  label = "Keluar",
}: {
  variant?: "solid" | "link";
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="nav-link text-smoke hover:text-ink disabled:opacity-50"
      >
        {busy ? "…" : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="border border-ink/20 px-4 py-2 text-[11px] uppercase tracking-widest2 text-ink transition hover:bg-ink hover:text-white disabled:opacity-50"
    >
      {busy ? "Memproses…" : label}
    </button>
  );
}
