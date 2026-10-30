import Link from "next/link";
import { requireAdminPage } from "@/lib/auth/page-guard";
import { can, effectivePermissions, ROLE_DEFS } from "@/lib/auth/rbac";
import { countUsers, storeBackend } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

const BACKEND_NOTE: Record<string, { label: string; note: string; durable: boolean }> = {
  kv: {
    label: "KV / Redis",
    note: "Data user tersimpan lintas instance dan lintas deploy.",
    durable: true,
  },
  file: {
    label: "File lokal",
    note: "Tersimpan di .data/users.json — persisten selama disk tidak dihapus.",
    durable: true,
  },
  tmp: {
    label: "File sementara (/tmp)",
    note: "Serverless: data bertahan selama instance masih hangat, hilang saat cold start. Untuk demo, akun seed dibuat ulang otomatis.",
    durable: false,
  },
  memory: {
    label: "Memori proses",
    note: "Hanya hidup selama instance hidup. Semua perubahan hilang saat restart.",
    durable: false,
  },
};

function Card({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="border border-ink/10 p-4">
      <p className="text-[10px] uppercase tracking-widest2 text-smoke">{label}</p>
      <p className="mt-1 font-display text-3xl leading-none">{value}</p>
      {sub ? <p className="mt-2 text-[11px] leading-relaxed text-smoke">{sub}</p> : null}
    </div>
  );
}

export default async function AdminHome({
  searchParams,
}: {
  searchParams?: { ditolak?: string };
}) {
  const session = requireAdminPage();
  const roleDef = ROLE_DEFS[session.primaryRole];
  const perms = effectivePermissions(session.roles);
  const backend = storeBackend();
  const backendInfo = BACKEND_NOTE[backend] ?? BACKEND_NOTE.memory;

  const canReadUsers = can(session.roles, "user:read");
  const counts = canReadUsers ? await countUsers() : null;

  return (
    <div className="space-y-8">
      {searchParams?.ditolak && (
        <div className="border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert">
          Akses ditolak. Role <strong>{session.primaryRole}</strong> tidak memiliki izin{" "}
          <code className="font-mono">{searchParams.ditolak}</code>. Izin diberikan oleh
          Super Admin lewat menu User &amp; Role.
        </div>
      )}

      <section>
        <h2 className="font-display text-2xl">Ringkasan</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-smoke">
          Panel ini menampilkan apa yang boleh Anda kelola menurut role{" "}
          <strong className="text-ink">{roleDef?.label ?? session.primaryRole}</strong>.
          Menu yang redup ada di sistem tetapi bukan wewenang role Anda.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Role aktif" value={roleDef?.label ?? session.primaryRole} sub={roleDef?.scope} />
          <Card label="Izin efektif" value={perms.length} sub="Hasil ekspansi wildcard role" />
          <Card
            label="Total user"
            value={counts ? counts.total : "—"}
            sub={counts ? "Terlihat karena Anda punya user:read" : "Butuh izin user:read"}
          />
          <Card
            label="Penyimpanan user"
            value={backendInfo.label}
            sub={backendInfo.note}
          />
        </div>
      </section>

      {counts && (
        <section>
          <h2 className="font-display text-2xl">Sebaran user per role</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {Object.keys(ROLE_DEFS).map((r) => (
              <div key={r} className="border border-ink/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-widest2 text-smoke">
                  {ROLE_DEFS[r as keyof typeof ROLE_DEFS].label}
                </p>
                <p className="mt-0.5 font-display text-2xl leading-none">
                  {counts.byRole[r] ?? 0}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/roles"
          className="border border-ink/10 p-4 transition hover:border-ink/40 hover:bg-bone"
        >
          <p className="text-[10px] uppercase tracking-widest2 text-brass">Skema akses</p>
          <p className="mt-1 font-display text-xl">Matriks RBAC</p>
          <p className="mt-1 text-[11px] leading-relaxed text-smoke">
            Tabel lengkap role × izin, termasuk RBAC customer dan RBAC admin.
          </p>
        </Link>

        {canReadUsers ? (
          <Link
            href="/admin/users"
            className="border border-ink/10 p-4 transition hover:border-ink/40 hover:bg-bone"
          >
            <p className="text-[10px] uppercase tracking-widest2 text-brass">Manajemen</p>
            <p className="mt-1 font-display text-xl">User &amp; Role</p>
            <p className="mt-1 text-[11px] leading-relaxed text-smoke">
              Ubah status akun dan tetapkan role. Hanya Super Admin.
            </p>
          </Link>
        ) : (
          <div className="border border-dashed border-ink/15 p-4 opacity-60">
            <p className="text-[10px] uppercase tracking-widest2 text-smoke">Terkunci</p>
            <p className="mt-1 font-display text-xl">User &amp; Role</p>
            <p className="mt-1 text-[11px] leading-relaxed text-smoke">
              Hanya role dengan izin <code className="font-mono">user:read</code> yang dapat
              membuka menu ini.
            </p>
          </div>
        )}
      </section>

      <section className="border border-ink/10 bg-bone p-4">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Catatan simulasi</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink/75">
          Akun seed (superadmin/katalog/order/gudang/customer @octarine.test) dibuat otomatis
          saat penyimpanan masih kosong. Di deployment serverless tanpa KV, akun yang Anda
          daftarkan sendiri dapat hilang setelah instance dimulai ulang — sambungkan
          Upstash Redis (KV) untuk penyimpanan permanen.
        </p>
      </section>
    </div>
  );
}
