import { ModulePanel } from "@/components/admin/ModulePanel";
import { requirePermissionPage } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default function AdminKatalogPage() {
  requirePermissionPage("catalog:update");

  return (
    <ModulePanel
      title="Katalog & Bundling"
      permission="catalog:update"
      roleNote="Admin Order dan Admin Gudang hanya bisa melihat katalog, tidak mengubahnya."
      description="Master produk, varian, harga, dan komposisi bundling bersumber dari ERP (Modul 4.1). Storefront membaca data itu, tidak menyimpannya sendiri."
      items={[
        "Menambah, mengubah, dan menonaktifkan produk serta varian",
        "Menetapkan harga jual dan harga coret",
        "Mengelola komposisi bundling: daftar komponen dan multiplier",
        "Melihat stok tersedia (baca saja — perubahan stok ada di menu Stok & Gudang)",
      ]}
      links={[
        { href: "/shop", label: "Lihat storefront" },
        { href: "/api/catalog/products", label: "API katalog", external: true },
      ]}
    />
  );
}
