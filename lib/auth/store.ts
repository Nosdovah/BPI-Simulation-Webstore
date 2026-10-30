import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./password";
import type { Role, StoredUser, UserStatus } from "./types";

/**
 * Penyimpanan user.
 *
 * Tiga backend, dipilih otomatis saat modul dimuat:
 *
 *   kv     → Vercel KV / Upstash Redis (env KV_REST_API_URL + KV_REST_API_TOKEN
 *            atau UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
 *            Satu-satunya backend yang benar-benar lintas-instance.
 *   file   → `.data/users.json` (lokal / VPS). Persisten antar restart.
 *   tmp    → `/tmp/osr-data/users.json`. Dipakai di serverless (Vercel) yang
 *            sistem filenya read-only kecuali /tmp. Bertahan selama instance
 *            masih hangat, hilang saat cold start.
 *   memory → cadangan terakhir. Hanya hidup selama instance hidup.
 *
 * Kontraknya sama untuk keempatnya, jadi pemanggil tidak perlu tahu backend
 * mana yang aktif. Backend aktif ditampilkan di /admin supaya operator tahu
 * apakah data user bertahan atau tidak.
 */

export type StoreBackend = "kv" | "file" | "tmp" | "memory";

const KV_KEY = "osr:users";

/** Kandidat lokasi file, dicoba berurutan sampai ada yang bisa ditulis. */
const FILE_CANDIDATES: Array<{ path: string; backend: StoreBackend }> = [
  { path: path.join(process.cwd(), ".data", "users.json"), backend: "file" },
  { path: path.join("/tmp", "osr-data", "users.json"), backend: "tmp" },
];

type Resolved = { path: string; backend: StoreBackend };

let resolved: Resolved | null = null;

/**
 * Uji tulis sungguhan, bukan sekadar `mkdir` berhasil.
 *
 * Di Vercel, direktori `.data` sudah ada (ikut ter-bundle karena memuat
 * snapshot ERP), jadi `mkdirSync(..., {recursive:true})` TIDAK melempar
 * error walaupun sistem berkasnya read-only. Tanpa probe ini, backend akan
 * melaporkan "file" padahal setiap penulisan gagal diam-diam.
 */
function isWritableDir(dir: string): boolean {
  const probe = path.join(dir, `.probe-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(probe, "ok", "utf8");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function resolveFilePath(): Resolved | null {
  if (resolved) return resolved;
  for (const candidate of FILE_CANDIDATES) {
    try {
      const dir = path.dirname(candidate.path);
      mkdirSync(dir, { recursive: true });
      if (!isWritableDir(dir)) continue;
      resolved = candidate;
      return candidate;
    } catch {
      // coba kandidat berikutnya
    }
  }
  return null;
}

function currentPath(): string {
  return resolveFilePath()?.path ?? FILE_CANDIDATES[0].path;
}

function kvConfig(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token =
    process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

export function storeBackend(): StoreBackend {
  if (kvConfig()) return "kv";
  return resolveFilePath()?.backend ?? "memory";
}

async function kvGet(): Promise<StoredUser[] | null> {
  const cfg = kvConfig();
  if (!cfg) return null;
  const res = await fetch(`${cfg.url}/get/${encodeURIComponent(KV_KEY)}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { result?: string | null };
  if (!body.result) return null;
  try {
    return JSON.parse(body.result) as StoredUser[];
  } catch {
    return null;
  }
}

async function kvSet(users: StoredUser[]): Promise<boolean> {
  const cfg = kvConfig();
  if (!cfg) return false;
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", KV_KEY, JSON.stringify(users)]),
  });
  return res.ok;
}

function fileGet(): StoredUser[] | null {
  try {
    const target = currentPath();
    if (!existsSync(target)) return null;
    return JSON.parse(readFileSync(target, "utf8")) as StoredUser[];
  } catch {
    return null;
  }
}

function fileSet(users: StoredUser[]): boolean {
  try {
    const target = currentPath();
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(users, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- seed --- */

/**
 * Akun awal supaya sistem tidak terkunci di deployment baru.
 *
 * Kredensial ini HANYA untuk simulasi akademik. Di produksi nyata, akun
 * seed wajib dihapus setelah SUPER_ADMIN pertama dibuat, dan password-nya
 * diganti.
 */
const SEED: Array<{
  email: string;
  password: string;
  name: string;
  role: Role;
}> = [
  { email: "superadmin@octarine.test", password: "Super#2026", name: "Super Admin", role: "SUPER_ADMIN" },
  { email: "katalog@octarine.test", password: "Katalog#2026", name: "Admin Katalog", role: "ADMIN_KATALOG" },
  { email: "order@octarine.test", password: "Order#2026", name: "Admin Order", role: "ADMIN_ORDER" },
  { email: "gudang@octarine.test", password: "Gudang#2026", name: "Admin Gudang", role: "ADMIN_GUDANG" },
  { email: "customer@octarine.test", password: "Customer#2026", name: "Pelanggan Contoh", role: "CUSTOMER" },
];

function buildSeed(): StoredUser[] {
  const now = Date.now();
  return SEED.map((s, i) => {
    const { hash, salt } = hashPassword(s.password);
    return {
      id: `seed-${i + 1}`,
      email: s.email,
      name: s.name,
      phone: null,
      roles: [s.role],
      primaryRole: s.role,
      status: "ACTIVE" as UserStatus,
      createdAt: now,
      lastLoginAt: null,
      passwordHash: hash,
      passwordSalt: salt,
      updatedAt: now,
    };
  });
}

/* --------------------------------------------------------------- cache --- */

const globalRef = globalThis as unknown as {
  __osrUsers?: StoredUser[];
  __osrUsersLoaded?: boolean;
  __osrUsersBackend?: StoreBackend;
};

function cache(): StoredUser[] {
  if (!globalRef.__osrUsers) globalRef.__osrUsers = [];
  return globalRef.__osrUsers;
}

async function load(): Promise<StoredUser[]> {
  if (globalRef.__osrUsersLoaded) return cache();

  const backend = storeBackend();
  globalRef.__osrUsersBackend = backend;

  let users: StoredUser[] | null = null;
  if (backend === "kv") users = await kvGet();
  else if (backend === "file") users = fileGet();

  if (!users || users.length === 0) {
    users = buildSeed();
    await persist(users);
  }

  globalRef.__osrUsers = users;
  globalRef.__osrUsersLoaded = true;
  return users;
}

async function persist(users: StoredUser[]): Promise<void> {
  const backend = globalRef.__osrUsersBackend ?? storeBackend();
  globalRef.__osrUsers = users;
  if (backend === "kv") {
    await kvSet(users);
  } else if (backend === "file") {
    fileSet(users);
  }
  // backend "memory": cukup di globalRef.
}

/* ---------------------------------------------------------------- API --- */

export async function listUsers(): Promise<StoredUser[]> {
  const users = await load();
  return [...users].sort((a, b) => a.createdAt - b.createdAt);
}

export async function findByEmail(email: string): Promise<StoredUser | null> {
  const users = await load();
  const needle = email.trim().toLowerCase();
  return users.find((u) => u.email.toLowerCase() === needle) ?? null;
}

export async function findById(id: string): Promise<StoredUser | null> {
  const users = await load();
  return users.find((u) => u.id === id) ?? null;
}

export type CreateUserInput = {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
  role: Role;
  status?: UserStatus;
};

export async function createUser(input: CreateUserInput): Promise<StoredUser> {
  const users = await load();
  const email = input.email.trim().toLowerCase();

  if (users.some((u) => u.email.toLowerCase() === email)) {
    throw new StoreError("EMAIL_TAKEN", "Email sudah terdaftar.");
  }

  const { hash, salt } = hashPassword(input.password);
  const now = Date.now();
  const user: StoredUser = {
    id: randomUUID(),
    email,
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    roles: [input.role],
    primaryRole: input.role,
    status: input.status ?? "ACTIVE",
    createdAt: now,
    lastLoginAt: null,
    passwordHash: hash,
    passwordSalt: salt,
    updatedAt: now,
  };

  const next = [...users, user];
  await persist(next);
  return user;
}

export async function touchLogin(id: string): Promise<void> {
  const users = await load();
  const next = users.map((u) =>
    u.id === id ? { ...u, lastLoginAt: Date.now(), updatedAt: Date.now() } : u
  );
  await persist(next);
}

export async function updateProfile(
  id: string,
  patch: { name?: string; phone?: string | null }
): Promise<StoredUser | null> {
  const users = await load();
  let updated: StoredUser | null = null;
  const next = users.map((u) => {
    if (u.id !== id) return u;
    updated = {
      ...u,
      name: patch.name?.trim() || u.name,
      phone: patch.phone === undefined ? u.phone : patch.phone?.trim() || null,
      updatedAt: Date.now(),
    };
    return updated;
  });
  if (updated) await persist(next);
  return updated;
}

export async function setUserStatus(id: string, status: UserStatus): Promise<boolean> {
  const users = await load();
  let found = false;
  const next = users.map((u) => {
    if (u.id !== id) return u;
    found = true;
    return { ...u, status, updatedAt: Date.now() };
  });
  if (found) await persist(next);
  return found;
}

export async function setUserRoles(id: string, roles: Role[]): Promise<boolean> {
  if (roles.length === 0) return false;
  const users = await load();
  let found = false;
  const next = users.map((u) => {
    if (u.id !== id) return u;
    found = true;
    return { ...u, roles, primaryRole: roles[0], updatedAt: Date.now() };
  });
  if (found) await persist(next);
  return found;
}

export async function countUsers(): Promise<{ total: number; byRole: Record<string, number> }> {
  const users = await load();
  const byRole: Record<string, number> = {};
  for (const u of users) {
    for (const r of u.roles) byRole[r] = (byRole[r] ?? 0) + 1;
  }
  return { total: users.length, byRole };
}

export class StoreError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
