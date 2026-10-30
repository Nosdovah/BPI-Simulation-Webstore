import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ProfileForm } from "@/components/auth/ProfileForm";
import { requireSessionPage } from "@/lib/auth/page-guard";
import { effectivePermissions, ROLE_DEFS } from "@/lib/auth/rbac";
import { findById } from "@/lib/auth/store";
import { recentOrders } from "@/lib/orders";

export const metadata: Metadata = { title: "Akun Saya — Octarine" };
export const dynamic = "force-dynamic";

function rupiah(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

export default async function AccountPage() {
  const session = requireSessionPage();
  const user = await findById(session.uid);
  const permissions = effectivePermissions(session.roles);
  const roleDef = ROLE_DEFS[session.primaryRole];

  const myOrders = recentOrders(200).filter(
    (o) => o.customer.email?.toLowerCase() === session.email.toLowerCase()
  );

  return (
    <div className="py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/10 pb-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest2 text-smoke">Akun saya</p>
          <h1 className="mt-2 font-display text-4xl">{session.name}</h1>
          <p className="mt-1 text-[12px] text-smoke">{session.email}</p>
        </div>
        <LogoutButton />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        {/* --- Kiri: profil & pesanan --- */}
        <div className="space-y-8">
          <section className="border border-ink/10 p-5">
            <h2 className="font-display text-2xl">Profil</h2>
            <p className="mt-1 mb-4 text-[11px] text-smoke">
              Email dan role tidak dapat diubah dari halaman ini.
            </p>
            <ProfileForm
              initialName={user?.name ?? session.name}
              initialPhone={user?.phone ?? null}
            />
          </section>

          <section className="border border-ink/10 p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl">Pesanan saya</h2>
              <Link href="/lacak-pesanan" className="text-[11px] underline underline-offset-4 text-smoke">
                Lacak pesanan lain
              </Link>
            </div>
            {myOrders.length === 0 ? (
              <p className="mt-4 text-[12px] leading-relaxed text-smoke">
                Belum ada pesanan yang tercatat untuk email ini di sesi server saat ini.
                Pesanan yang dibuat sebelum instance dimulai ulang tidak tersimpan di sini —
                gunakan halaman lacak pesanan dengan nomor pesanan Anda.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-ink/10">
                {myOrders.map((o) => (
                  <li key={o.ref} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <Link
                        href={`/order/${o.ref}`}
                        className="text-[12px] underline underline-offset-4"
                      >
                        {o.ref}
                      </Link>
                      <p className="mt-0.5 text-[10px] uppercase tracking-widest2 text-smoke">
                        {new Date(o.createdAt).toLocaleString("id-ID")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[12px]">{rupiah(o.totalIdr)}</p>
                      <p className="text-[10px] uppercase tracking-widest2 text-brass">
                        {o.status}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* --- Kanan: role & hak akses --- */}
        <div className="space-y-6">
          <section className="border border-ink/10 bg-bone p-5">
            <p className="text-[10px] uppercase tracking-widest2 text-smoke">Role aktif</p>
            <p className="mt-2 font-display text-2xl">{roleDef?.label ?? session.primaryRole}</p>
            <p className="mt-1 text-[11px] text-smoke">{roleDef?.scope}</p>
            <p className="mt-3 text-[12px] leading-relaxed text-ink/75">
              {roleDef?.description}
            </p>
            <div className="mt-4 flex flex-wrap gap-1">
              {session.roles.map((r) => (
                <span
                  key={r}
                  className="border border-ink/20 px-2 py-1 text-[10px] uppercase tracking-widest2"
                >
                  {r}
                </span>
              ))}
            </div>
            <p className="mt-3 text-[10px] uppercase tracking-widest2 text-smoke">
              Status akun: {session.status}
            </p>
          </section>

          <section className="border border-ink/10 p-5">
            <h2 className="font-display text-xl">Hak akses Anda</h2>
            <p className="mt-1 text-[11px] text-smoke">
              {permissions.length} izin efektif dari role yang Anda pegang.
            </p>
            <ul className="mt-3 grid gap-1">
              {permissions.map((p) => (
                <li key={p} className="font-mono text-[11px] text-ink/80">
                  {p}
                </li>
              ))}
            </ul>
          </section>

          {roleDef?.modules?.length ? (
            <section className="border border-ink/10 p-5">
              <h2 className="font-display text-xl">Modul yang Anda kelola</h2>
              <ul className="mt-3 space-y-1 text-[12px] text-ink/80">
                {roleDef.modules.map((m) => (
                  <li key={m}>— {m}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
