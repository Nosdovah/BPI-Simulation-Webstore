import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { currentSession } from "@/lib/auth/guard";
import { isAdminRole } from "@/lib/auth/rbac";

export const metadata: Metadata = {
  title: "Daftar Akun — Octarine",
};

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const session = currentSession();
  if (session) {
    redirect(session.roles.some(isAdminRole) ? "/admin" : "/akun");
  }

  return (
    <div className="py-12">
      <div className="mx-auto mb-10 max-w-xl text-center">
        <p className="text-[11px] uppercase tracking-widest2 text-brass">Keanggotaan</p>
        <h1 className="mt-2 font-display text-[34px] leading-tight">Daftar Akun</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-smoke">
          Customer dapat mendaftar langsung. Akun admin memerlukan kode undangan
          dari Super Admin — pemisahan ini yang menjaga agar hak istimewa tidak
          bisa diberikan sendiri.
        </p>
      </div>
      <RegisterForm />
    </div>
  );
}
