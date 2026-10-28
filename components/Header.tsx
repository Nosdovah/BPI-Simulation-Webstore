"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Mode } from "@/lib/types";
import { useCart } from "./CartProvider";
import { ModeSwitcher } from "./ModeSwitcher";

const NAV = [
  { href: "/shop", label: "Shop" },
  { href: "/collections", label: "Collections" },
  { href: "/promo", label: "Promo" },
  { href: "/blog", label: "Blog" },
];

export function Header({ mode }: { mode: Mode }) {
  const { count } = useCart();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur">
      <div className="sim-ribbon">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-1 text-[9px] uppercase tracking-widest2 text-white">
          <span>Simulasi — bukan toko resmi</span>
          <span className="hidden sm:inline">
            Octarine Sandbox · replika untuk latihan DMAIC
          </span>
        </div>
      </div>

      <div className="border-b border-ink/10">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-display text-[26px] leading-none tracking-tight">Octarine.</span>
            <span className="text-[8px] uppercase tracking-widest2 text-smoke">Sandbox</span>
          </Link>

          <nav className="ml-6 hidden items-center gap-7 md:flex">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link ${active ? "text-ink underline underline-offset-8" : ""}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ModeSwitcher initialMode={mode} />
            <Link href="/wishlist" className="nav-link hidden sm:inline">
              Wishlist
            </Link>
            <Link href="/cart" className="nav-link flex items-center gap-1">
              Cart
              <span className="inline-flex h-5 min-w-5 items-center justify-center border border-ink/30 px-1 text-[10px] leading-none">
                {count}
              </span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}