import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav, type NavItem } from "@/components/admin/AdminNav";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { requireAdminPage } from "@/lib/auth/page-guard";
import { can, ROLE_DEFS } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "Panel Admin — Octarine" };
export const dynamic = "force-dynamic";

/**
 * Kerangka panel admin.
 *
 * Penjagaan dilakukan di sini (satu pintu), bukan di setiap halaman:
 * kalau bukan admin → /akun, kalau belum masuk → /login. Setiap halaman
 * anak tetap memeriksa permission-nya sendiri, karena layout tidak tahu
 * halaman mana yang sedang dibuka.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = requireAdminPage();
  const roleDef = ROLE_DEFS[session.primaryRole];

  const items: NavItem[] = [
    { href: "/admin", label: "Ringkasan", hint: "Status sistem", allowed: true },
    {
      href: "/admin/users",
      label: "User & Role",
      hint: "Butuh user:read",
      allowed: can(session.roles, "user:read"),
    },
    { href: "/admin/roles", label: "Matriks RBAC", hint: "Role × izin", allowed: true },
    {
      href: "/admin/katalog",
      label: "Katalog & Bundling",
      hint: "Modul 4.1",
      allowed: can(session.roles, "catalog:update") || can(session.roles, "bundle:update"),
    },
    {
      href: "/admin/stok",
      label: "Stok & Gudang",
      hint: "Butuh stock:update",
      allowed: can(session.roles, "stock:update"),
    },
    {
      href: "/admin/pesanan",
      label: "Pesanan",
      hint: "Modul 4.2",
      allowed: can(session.roles, "order:update"),
    },
  ];

  return (
    <div className="py-8">
      <div className="border-b border-ink/10 pb-5">
        <p className="text-[10px] uppercase tracking-widest2 text-brass">Panel admin</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">{roleDef?.label ?? session.primaryRole}</h1>
            <p className="text-[11px] text-smoke">
              {session.name} · {session.email}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-[11px] uppercase tracking-widest2 text-smoke hover:text-ink">
              Lihat storefront
            </Link>
            <LogoutButton variant="link" />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[230px_1fr]">
        <aside>
          <AdminNav items={items} />
          <div className="mt-6 border border-ink/10 bg-bone p-3">
            <p className="text-[10px] uppercase tracking-widest2 text-smoke">Cakupan role</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink/75">{roleDef?.scope}</p>
            <p className="mt-2 text-[10px] uppercase tracking-widest2 text-smoke">Modul</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-ink/75">
              {(roleDef?.modules ?? []).map((m) => (
                <li key={m}>— {m}</li>
              ))}
            </ul>
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
