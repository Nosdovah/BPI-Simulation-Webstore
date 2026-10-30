"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  href: string;
  label: string;
  hint: string;
  /** false = tampil tapi tidak bisa diklik (role tidak punya izin). */
  allowed: boolean;
};

/**
 * Navigasi panel admin.
 *
 * Item yang tidak diizinkan tetap DITAMPILKAN (redup, tidak bisa diklik),
 * bukan disembunyikan. Alasannya: pengguna perlu tahu modul apa yang ada
 * di sistem dan siapa yang memegangnya — ini juga bukti pemisahan tugas
 * yang jadi inti perbaikan prosesnya.
 */
export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        if (!item.allowed) {
          return (
            <div
              key={item.href}
              title="Role Anda tidak punya izin untuk modul ini"
              className="cursor-not-allowed border-l-2 border-transparent px-3 py-2 opacity-40"
            >
              <p className="text-[12px] text-ink">{item.label}</p>
              <p className="text-[10px] uppercase tracking-widest2 text-smoke">{item.hint}</p>
            </div>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`block border-l-2 px-3 py-2 transition ${
              active
                ? "border-brass bg-bone text-ink"
                : "border-transparent text-ink/70 hover:border-ink/20 hover:bg-bone"
            }`}
          >
            <p className="text-[12px]">{item.label}</p>
            <p className="text-[10px] uppercase tracking-widest2 text-smoke">{item.hint}</p>
          </Link>
        );
      })}
    </nav>
  );
}
