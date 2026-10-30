import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { currentSession } from "@/lib/auth/guard";
import { isAdminRole } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "Masuk — Octarine" };
export const dynamic = "force-dynamic";

/**
 * Halaman masuk. Kalau sesi sudah ada, langsung dilempar ke halaman
 * sesuai role — tidak ada gunanya menampilkan form lagi.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const session = currentSession();
  if (session) redirect(session.roles.some(isAdminRole) ? "/admin" : "/akun");

  const notice =
    searchParams?.status === "suspended"
      ? "Akun Anda dinonaktifkan. Hubungi Super Admin untuk mengaktifkan kembali."
      : searchParams?.status === "pending"
        ? "Akun Anda masih menunggu persetujuan Super Admin."
        : null;

  return (
    <div className="py-12">
      <div className="mx-auto mb-8 max-w-md text-center">
        <p className="text-[11px] uppercase tracking-widest2 text-brass">Keanggotaan</p>
        <h1 className="mt-2 font-display text-[34px] leading-tight">Masuk</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-smoke">
          Admin diarahkan ke panel pengelolaan, customer ke halaman akun.
        </p>
      </div>

      {notice && (
        <div className="mx-auto mb-5 max-w-md border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert">
          {notice}
        </div>
      )}

      <LoginForm />
    </div>
  );
}
