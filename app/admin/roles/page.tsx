import { Fragment } from "react";
import { requireAdminPage } from "@/lib/auth/page-guard";
import {
  ADMIN_ROLES,
  can,
  effectivePermissions,
  ROLE_DEFS,
  ROLE_ORDER,
} from "@/lib/auth/rbac";
import { PERMISSIONS, type Permission, type Role } from "@/lib/auth/types";

export const dynamic = "force-dynamic";

const RESOURCE_LABEL: Record<string, string> = {
  user: "Manajemen user",
  catalog: "Katalog & produk (4.1)",
  bundle: "Bundling / BOM (4.1)",
  stock: "Stok & gudang",
  order: "Pesanan & status (4.2)",
  webhook: "Jejak integrasi",
  report: "Laporan",
  profile: "Profil sendiri",
};

/** Kelompokkan permission berdasarkan prefix resource-nya. */
function grouped(): Array<{ resource: string; items: Permission[] }> {
  const map = new Map<string, Permission[]>();
  for (const p of PERMISSIONS) {
    const [resource] = p.split(":");
    if (!map.has(resource)) map.set(resource, []);
    map.get(resource)!.push(p);
  }
  return Array.from(map.entries()).map(([resource, items]) => ({ resource, items }));
}

function Mark({ on }: { on: boolean }) {
  // Glyph dipilih supaya beda antara "diizinkan" dan "tidak" terbaca dari
  // bentuk, bukan hanya dari kontras warna — titik kecil abu-abu mudah
  // disalahartikan sebagai sel kosong saat dipindai cepat.
  return on ? (
    <span className="font-bold text-ink" aria-label="diizinkan">
      ●
    </span>
  ) : (
    <span className="text-ink/35" aria-label="tidak diizinkan">
      —
    </span>
  );
}

export default function RolesMatrixPage() {
  requireAdminPage();

  const groups = grouped();
  const customerRoles: Role[] = ["CUSTOMER"];
  const adminRoles: Role[] = ADMIN_ROLES;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-2xl">Matriks RBAC</h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-smoke">
          Model akses memakai RBAC: pengguna memegang <strong>role</strong>, role memegang{" "}
          <strong>izin</strong> berbentuk <code className="font-mono">resource:action</code>.
          Wewenang tidak pernah diberikan langsung ke orang — selalu lewat role, sehingga
          perubahan hak akses bisa diaudit sebagai satu peristiwa.
        </p>
      </div>

      {/* ---------- RBAC User (storefront) ---------- */}
      <section>
        <div className="flex items-baseline gap-3 border-b border-ink/10 pb-2">
          <h3 className="font-display text-xl">RBAC User — storefront</h3>
          <span className="text-[10px] uppercase tracking-widest2 text-smoke">
            {customerRoles.length} role
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-smoke">
          Satu role untuk pelanggan. Cakupannya sengaja sempit: hanya katalog publik dan
          data miliknya sendiri. Tidak ada izin yang membuka data pelanggan lain.
        </p>

        {customerRoles.map((r) => {
          const def = ROLE_DEFS[r];
          const perms = effectivePermissions([r]);
          return (
            <div key={r} className="mt-4 border border-ink/10 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-display text-lg">{def.label}</p>
                  <p className="text-[10px] uppercase tracking-widest2 text-smoke">
                    {r} · {def.scope}
                  </p>
                </div>
                <p className="text-[10px] uppercase tracking-widest2 text-brass">
                  {perms.length} izin
                </p>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink/75">{def.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {perms.map((p) => (
                  <span
                    key={p}
                    className="border border-ink/15 bg-bone px-2 py-0.5 font-mono text-[10px]"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* ---------- RBAC Admin (internal) ---------- */}
      <section>
        <div className="flex items-baseline gap-3 border-b border-ink/10 pb-2">
          <h3 className="font-display text-xl">RBAC Admin — panel internal</h3>
          <span className="text-[10px] uppercase tracking-widest2 text-smoke">
            {adminRoles.length} role
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-smoke">
          Empat role admin dipisah mengikuti pembagian modul integrasi ERP. Prinsipnya
          pemisahan tugas: yang mengubah katalog bukan yang mengubah stok, yang mengubah stok
          bukan yang menutup pesanan. Ini menutup celah proses lama, di mana satu admin bisa
          melompati status pesanan mana pun lewat klik manual.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {adminRoles.map((r) => {
            const def = ROLE_DEFS[r];
            const perms = effectivePermissions([r]);
            return (
              <div key={r} className="border border-ink/10 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-lg">{def.label}</p>
                  <p className="text-[10px] uppercase tracking-widest2 text-brass">
                    {perms.length} izin
                  </p>
                </div>
                <p className="text-[10px] uppercase tracking-widest2 text-smoke">
                  {r} · {def.scope}
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-ink/75">{def.description}</p>
                <p className="mt-2 text-[10px] uppercase tracking-widest2 text-smoke">Modul</p>
                <p className="text-[11px] text-ink/75">{def.modules.join(" · ")}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- Matriks penuh ---------- */}
      <section>
        <div className="flex items-baseline gap-3 border-b border-ink/10 pb-2">
          <h3 className="font-display text-xl">Matriks role × izin</h3>
          <span className="text-[10px] uppercase tracking-widest2 text-smoke">
            {PERMISSIONS.length} izin · {ROLE_ORDER.length} role
          </span>
        </div>

        <div className="mt-3 overflow-x-auto border border-ink/10">
          <table className="w-full min-w-[760px] text-left text-[11px]">
            <thead className="bg-bone">
              <tr>
                <th className="px-3 py-2 text-[10px] font-normal uppercase tracking-widest2 text-smoke">
                  Izin
                </th>
                {ROLE_ORDER.map((r) => (
                  <th
                    key={r}
                    className="px-2 py-2 text-center text-[10px] font-normal uppercase tracking-widest2 text-smoke"
                  >
                    {ROLE_DEFS[r].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {groups.map((g) => (
                <Fragment key={g.resource}>
                  <tr className="bg-mist/60">
                    <td
                      colSpan={ROLE_ORDER.length + 1}
                      className="px-3 py-1.5 text-[10px] uppercase tracking-widest2 text-ink"
                    >
                      {RESOURCE_LABEL[g.resource] ?? g.resource}
                    </td>
                  </tr>
                  {g.items.map((p) => (
                    <tr key={p}>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-ink/85">{p}</td>
                      {ROLE_ORDER.map((r) => (
                        <td key={r} className="px-2 py-1.5 text-center">
                          <Mark on={can([r], p)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-[10px] uppercase tracking-widest2 text-smoke">
          <span>
            <span className="font-bold text-ink">●</span> diizinkan
          </span>
          <span>
            <span className="text-ink/35">—</span> tidak diizinkan
          </span>
          <span>SUPER_ADMIN memegang wildcard *</span>
        </div>
      </section>

      {/* ---------- Aturan tambahan ---------- */}
      <section className="border border-ink/10 bg-bone p-4">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">
          Aturan yang ditegakkan di server
        </p>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-ink/80">
          <li>
            <strong>Wildcard.</strong> SUPER_ADMIN memakai <code className="font-mono">*</code>,
            diekspansi saat pemeriksaan sehingga izin baru otomatis diwarisi.
          </li>
          <li>
            <strong>Keputusan di server.</strong> UI hanya menyembunyikan tombol. Setiap route
            memanggil pemeriksaan izin sendiri; request manual dengan cookie yang sama tetap
            ditolak 403.
          </li>
          <li>
            <strong>Registrasi admin butuh kode undangan.</strong> Tanpa{" "}
            <code className="font-mono">OSR_ADMIN_INVITE_CODE</code> yang cocok, permintaan
            role admin ditolak — role tidak bisa dinaikkan sendiri lewat body request.
          </li>
          <li>
            <strong>Registrasi customer dikunci.</strong> Field{" "}
            <code className="font-mono">role</code> yang dikirim pada mode customer diabaikan;
            server selalu menetapkan CUSTOMER.
          </li>
          <li>
            <strong>Anti-lockout.</strong> Super Admin tidak dapat mengubah role/status akunnya
            sendiri.
          </li>
          <li>
            <strong>Role di sesi.</strong> Perubahan role berlaku pada login berikutnya, karena
            sesi menyimpan role pada saat cookie ditandatangani.
          </li>
        </ul>
      </section>
    </div>
  );
}
