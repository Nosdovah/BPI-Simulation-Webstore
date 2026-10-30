import { ModulePanel } from "@/components/admin/ModulePanel";
import { requirePermissionPage } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default function AdminStokPage() {
  requirePermissionPage("stock:update");

  return (
    <ModulePanel
      title="Stok & Gudang"
      permission="stock:update"
      roleNote="Admin Katalog dan Admin Order hanya bisa membaca stok, tidak mengubahnya."
      description="Stok per gudang dan kuota bundling dikelola di sini. Pemisahan ini yang mencegah orang yang mengubah harga ikut mengubah angka ketersediaan."
      items={[
        "Memutakhirkan stok per gudang dan per SKU",
        "Menetapkan kuota bundling manual",
        "Memicu sinkronisasi stok ke ERP/WMS",
        "Melihat pesanan (baca saja — transisi status ada di menu Pesanan)",
      ]}
      links={[
        { href: "/shop", label: "Cek tampilan stok" },
        { href: "/api/catalog/stock", label: "API stok", external: true },
      ]}
    />
  );
}
