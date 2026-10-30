import { PERMISSIONS, type Permission, type Role } from "./types";

/**
 * Matriks izin per role.
 *
 * Aturan penyusunan:
 *   1. Least privilege — role hanya dapat apa yang dibutuhkan modulnya.
 *   2. Pemisahan tugas (segregation of duties) — yang mengubah katalog
 *      bukan yang mengubah stok, yang mengubah stok bukan yang menutup
 *      order. Ini meniru kontrol yang hilang di proses AS-IS, di mana
 *      satu admin klik manual bisa melompati status apa pun.
 *   3. Hanya SUPER_ADMIN yang boleh menyentuh user & role.
 */

export type RoleDefinition = {
  label: string;
  scope: string;
  description: string;
  permissions: Permission[] | ["*"];
  /** Modul ERP yang jadi tanggung jawabnya. */
  modules: string[];
};

export const ROLE_DEFS: Record<Role, RoleDefinition> = {
  SUPER_ADMIN: {
    label: "Super Admin",
    scope: "Sistem",
    description:
      "Pemilik sistem. Satu-satunya role yang dapat membuat, mengubah, menonaktifkan user dan menetapkan role. Semua izin modul diwarisi.",
    permissions: ["*"],
    modules: ["Semua modul", "Manajemen user"],
  },

  ADMIN_KATALOG: {
    label: "Admin Katalog",
    scope: "Modul 4.1 — Katalog & Produk",
    description:
      "Mengelola master produk, varian, harga, dan komposisi bundling (BOM + multiplier). Tidak dapat mengubah stok fisik maupun status pesanan.",
    permissions: [
      "catalog:read",
      "catalog:create",
      "catalog:update",
      "catalog:delete",
      "bundle:read",
      "bundle:update",
      "stock:read",
      "webhook:read",
      "report:read",
      "profile:read",
      "profile:update",
    ],
    modules: ["4.1 Katalog", "4.1 Bundling"],
  },

  ADMIN_ORDER: {
    label: "Admin Order",
    scope: "Modul 4.2 — Order & Status",
    description:
      "Mengelola pesanan masuk, transisi status, nomor resi, pembatalan, dan refund. Tidak dapat mengubah harga katalog maupun stok.",
    permissions: [
      "order:read",
      "order:update",
      "order:cancel",
      "order:refund",
      "catalog:read",
      "stock:read",
      "webhook:read",
      "webhook:replay",
      "report:read",
      "profile:read",
      "profile:update",
    ],
    modules: ["4.2 Order", "4.2 Status & Tracking"],
  },

  ADMIN_GUDANG: {
    label: "Admin Gudang",
    scope: "Stok & Gudang",
    description:
      "Mengelola stok per gudang, kuota bundling, dan memicu sinkronisasi stok ke ERP/WMS. Dapat melihat order tapi tidak mengubah statusnya.",
    permissions: [
      "stock:read",
      "stock:update",
      "stock:sync",
      "bundle:read",
      "catalog:read",
      "order:read",
      "webhook:read",
      "report:read",
      "profile:read",
      "profile:update",
    ],
    modules: ["Stok multi-gudang", "Sinkronisasi WMS"],
  },

  CUSTOMER: {
    label: "Customer",
    scope: "Storefront",
    description:
      "Pelanggan. Hanya dapat melihat katalog publik, mengelola profilnya sendiri, dan melihat pesanan miliknya sendiri.",
    permissions: ["catalog:read", "profile:read", "profile:update", "order:self:read"],
    modules: ["Storefront"],
  },
};

export const ROLE_ORDER: Role[] = [
  "SUPER_ADMIN",
  "ADMIN_KATALOG",
  "ADMIN_ORDER",
  "ADMIN_GUDANG",
  "CUSTOMER",
];

/** Semua role admin (untuk tampilan matriks & penugasan oleh Super Admin). */
export const ADMIN_ROLES: Role[] = [
  "SUPER_ADMIN",
  "ADMIN_KATALOG",
  "ADMIN_ORDER",
  "ADMIN_GUDANG",
];

/**
 * Role admin yang boleh didaftarkan sendiri lewat /register memakai kode
 * undangan biasa.
 *
 * SUPER_ADMIN sengaja TIDAK termasuk: kalau kode undangan bocor, dampaknya
 * hanya penambahan operator modul — bukan pengambilalihan sistem. Super Admin
 * baru hanya lahir dari akun seed atau ditetapkan Super Admin lain lewat
 * /admin/users (izin user:assign_role).
 */
export const REGISTERABLE_ROLES: Role[] = [
  "ADMIN_KATALOG",
  "ADMIN_ORDER",
  "ADMIN_GUDANG",
];

export function isAdminRole(role: Role): boolean {
  return role !== "CUSTOMER";
}

/**
 * Cek satu permission. Mendukung wildcard `*` (semua) dan `resource:*`.
 */
export function can(roles: Role[] | Role | null | undefined, permission: Permission): boolean {
  if (!roles) return false;
  const list = Array.isArray(roles) ? roles : [roles];
  if (list.length === 0) return false;

  const [resource] = permission.split(":");

  for (const role of list) {
    const def = ROLE_DEFS[role];
    if (!def) continue;
    const perms = def.permissions as string[];
    if (perms.includes("*")) return true;
    if (perms.includes(permission)) return true;
    if (perms.includes(`${resource}:*`)) return true;
  }
  return false;
}

/** Daftar permission efektif (hasil ekspansi wildcard) untuk ditampilkan. */
export function effectivePermissions(roles: Role[]): Permission[] {
  const out = new Set<Permission>();
  // Basis daftar = katalog izin resmi (PERMISSIONS), bukan gabungan izin
  // antar-role. Kalau memakai gabungan role, role ber-wildcard ("*") tidak
  // akan pernah memunculkan izin yang tidak ditulis eksplisit di role lain.
  for (const p of PERMISSIONS) {
    if (can(roles, p)) out.add(p);
  }
  return Array.from(out).sort();
}

/** Permission yang dimiliki role tapi tidak dimiliki role pembanding. */
export function diffPermissions(a: Role, b: Role): Permission[] {
  return effectivePermissions([a]).filter((p) => !can([b], p));
}
