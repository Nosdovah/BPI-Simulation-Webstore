/**
 * Tipe dasar autentikasi & otorisasi.
 *
 * Model peran (role) mengikuti pembagian modul integrasi ERP:
 *   Modul 4.1 Katalog & Stok  → ADMIN_KATALOG, ADMIN_GUDANG
 *   Modul 4.2 Order & Status  → ADMIN_ORDER
 *   Storefront (pelanggan)    → CUSTOMER
 *   Pemilik sistem            → SUPER_ADMIN
 *
 * Satu user boleh punya lebih dari satu role (kolom `roles`), tapi role
 * utama disimpan di `primaryRole` untuk tampilan.
 */

export const ROLES = [
  "SUPER_ADMIN",
  "ADMIN_KATALOG",
  "ADMIN_ORDER",
  "ADMIN_GUDANG",
  "CUSTOMER",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Permission ditulis sebagai `resource:action` supaya bisa dicocokkan
 * dengan wildcard (`catalog:*`, `*`).
 */
export const PERMISSIONS = [
  // --- Manajemen user (hanya SUPER_ADMIN) ---
  "user:read",
  "user:create",
  "user:update",
  "user:delete",
  "user:assign_role",

  // --- Modul 4.1 — katalog & produk ---
  "catalog:read",
  "catalog:create",
  "catalog:update",
  "catalog:delete",
  "bundle:read",
  "bundle:update",

  // --- Stok & gudang ---
  "stock:read",
  "stock:update",
  "stock:sync",

  // --- Modul 4.2 — order & status ---
  "order:read",
  "order:update",
  "order:cancel",
  "order:refund",

  // --- Jejak integrasi ---
  "webhook:read",
  "webhook:replay",

  // --- Laporan ---
  "report:read",

  // --- Diri sendiri (customer maupun admin) ---
  "profile:read",
  "profile:update",
  "order:self:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type UserStatus = "ACTIVE" | "PENDING" | "SUSPENDED";

/** Bentuk user yang aman dikirim ke klien — tanpa hash password. */
export type PublicUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  roles: Role[];
  primaryRole: Role;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
};

/** Bentuk di penyimpanan — memuat hash password. */
export type StoredUser = PublicUser & {
  passwordHash: string;
  passwordSalt: string;
  updatedAt: number;
};

export type SessionPayload = {
  uid: string;
  email: string;
  name: string;
  roles: Role[];
  primaryRole: Role;
  status: UserStatus;
  iat: number;
  exp: number;
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function toPublicUser(user: StoredUser): PublicUser {
  const { passwordHash, passwordSalt, updatedAt, ...rest } = user;
  void passwordHash;
  void passwordSalt;
  void updatedAt;
  return rest;
}
