import Link from "next/link";
import type { Permission } from "@/lib/auth/types";

/**
 * Kerangka halaman modul di panel admin.
 *
 * Halaman modul di panel ini berfungsi sebagai *gerbang wewenang*: ia
 * membuktikan siapa yang boleh masuk ke modul tersebut. Pengelolaan data
 * master sendiri dilakukan di ERP (sumber kebenaran) — storefront hanya
 * membaca. Jadi yang ditampilkan di sini adalah status wewenang, bukan
 * form CRUD palsu yang tidak mengubah apa pun.
 */
export function ModulePanel({
  title,
  permission,
  roleNote,
  description,
  items,
  links,
}: {
  title: string;
  permission: Permission;
  roleNote: string;
  description: string;
  items: string[];
  links?: Array<{ href: string; label: string; external?: boolean }>;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl">{title}</h2>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-smoke">{description}</p>
      </div>

      <div className="border border-ink/10 bg-bone p-4">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Gerbang izin</p>
        <p className="mt-1 font-mono text-[12px] text-ink">{permission}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink/75">
          Anda bisa membuka halaman ini karena role Anda memegang izin di atas. Role lain yang
          tidak memegangnya akan dialihkan keluar halaman ini. {roleNote}
        </p>
      </div>

      <div className="border border-ink/10 p-4">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">
          Yang termasuk wewenang ini
        </p>
        <ul className="mt-2 space-y-1 text-[12px] text-ink/80">
          {items.map((i) => (
            <li key={i}>— {i}</li>
          ))}
        </ul>
      </div>

      {links?.length ? (
        <div className="flex flex-wrap gap-2">
          {links.map((l) =>
            l.external ? (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="border border-ink/20 px-4 py-2 text-[11px] uppercase tracking-widest2 hover:bg-ink hover:text-white"
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.href}
                href={l.href}
                className="border border-ink/20 px-4 py-2 text-[11px] uppercase tracking-widest2 hover:bg-ink hover:text-white"
              >
                {l.label}
              </Link>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
