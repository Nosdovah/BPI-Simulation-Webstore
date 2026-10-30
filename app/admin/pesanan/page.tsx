import { ModulePanel } from "@/components/admin/ModulePanel";
import { requirePermissionPage } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default function AdminPesananPage() {
  requirePermissionPage("order:update");

  return (
    <ModulePanel
      title="Pesanan & Status"
      permission="order:update"
      roleNote="Admin Katalog dan Admin Gudang tidak bisa mengubah status pesanan."
      description="Modul 4.2: pesanan masuk, transisi status, nomor resi, pembatalan, dan refund. Status hanya boleh bergerak maju sesuai urutan baku — tidak ada lompatan manual."
      items={[
        "Memindahkan status sesuai urutan baku (PAID → PROCESS → … → COMPLETED)",
        "Mengisi nomor resi dan memicu pelacakan ke 3PL",
        "Membatalkan pesanan dan memproses refund",
        "Membaca ulang jejak webhook untuk pesanan yang macet",
      ]}
      links={[
        { href: "/lacak-pesanan", label: "Halaman lacak" },
        { href: "/api/orders", label: "API pesanan", external: true },
      ]}
    />
  );
}
