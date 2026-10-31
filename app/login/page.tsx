import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { currentSession } from "@/lib/auth/guard";
import { isAdminRole } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "Masuk — Octarine" };
export const dynamic = "force-dynamic";

/** Hanya izinkan tujuan internal (`/...`), supaya `?next=` tidak jadi open redirect. */
function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

/**
 * Halaman masuk. Kalau sesi sudah ada, langsung dilempar ke tujuan:
 * `?next=` kalau ada (mis. kembali ke /checkout), kalau tidak sesuai role.
 *
 * `?reason=cart` dipakai gerbang checkout: pengguna diberi tahu bahwa ia
 * memang perlu akun untuk menyelesaikan pesanan, bukan gagal tanpa alasan.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams?: { status?: string; next?: string; reason?: string };
}) {
  const next = safeNext(searchParams?.next);
  const session = currentSession();
  if (session) {
    if (next) redirect(next);
    redirect(session.roles.some(isAdminRole) ? "/admin" : "/akun");
  }

  const notice =
    searchParams?.status === "suspended"
      ? "Akun Anda dinonaktifkan. Hubungi Super Admin untuk mengaktifkan kembali."
      : searchParams?.status === "pending"
        ? "Akun Anda masih menunggu persetujuan Super Admin."
        : searchParams?.reason === "cart"
          ? "Masuk dulu untuk menyelesaikan pesanan. Isi keranjangmu ikut pindah ke akun."
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

      <LoginForm next={next ?? undefined} />
    </div>
  );
}
