import { requirePermissionPage } from "@/lib/auth/page-guard";
import { UsersManager } from "@/components/admin/UsersManager";

export const dynamic = "force-dynamic";

export default function AdminUsersPage() {
  const session = requirePermissionPage("user:read");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl">User &amp; Role</h2>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-smoke">
          Menetapkan role berarti memberikan satu set izin. Tidak ada izin yang diberikan
          per orang — perubahan wewenang selalu lewat role, sehingga jejaknya bisa diaudit.
        </p>
      </div>
      <UsersManager selfId={session.uid} />
    </div>
  );
}
