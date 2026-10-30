import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./password";
import type { Role, StoredUser, UserStatus } from "./types";

/**
 * Penyimpanan user.
 *
 * Empat backend, dipilih otomatis saat modul dimuat:
 *
 *   supabase → tabel `public.osr_user` (lihat
 *              supabase/migrations/20261031000200_user.sql).
 *              Diakses lewat PostgREST dengan `fetch`, jadi tidak perlu
 *              dependensi tambahan. WAJIB service_role: RLS tabel ini
 *              sengaja tanpa policy, anon key ditolak total.
 *              Satu-satunya backend yang benar-benar persisten lintas
 *              instance serverless — dipakai di production.
 *   kv       → Vercel KV / Upstash Redis (env KV_REST_API_URL + KV_REST_API_TOKEN
 *              atau UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
 *              Cadangan kalau Supabase tidak dipakai.
 *   file     → `.data/users.json` (lokal / VPS). Persisten antar restart.
 *   tmp      → `/tmp/osr-data/users.json`. Bertahan selama instance masih
 *              hangat, hilang saat cold start.
 *   memory   → cadangan terakhir. Hanya hidup selama instance hidup.
 *
 * Urutan prioritas itu disengaja: Supabase menang atas KV, dan keduanya
 * menang atas berkas. Backend aktif ditampilkan di /admin supaya operator
 * tahu apakah data user bertahan atau tidak.
 *
 * Catatan penting soal cache: jalur berkas/KV memakai cache `globalThis`
 * karena pembacaan disk mahal dan hanya satu proses. Jalur Supabase TIDAK
 * memakai cache sama sekali — cache per-proses justru sumber bug di
 * serverless: instance B akan menyajikan daftar user versi B.
 */

export type StoreBackend = "supabase" | "kv" | "file" | "tmp" | "memory";

const KV_KEY = "osr:users";
const SB_TABLE = "osr_user";

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

/* ==================================================================== *
 *  Backend: Supabase (PostgREST)
 * ==================================================================== */

type SbConfig = { base: string; key: string };

function sbConfig(): SbConfig | null {
  const base = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();
  if (!base || !key) return null;
  return { base, key };
}

/**
 * Panggil PostgREST. `json` = true untuk respons yang berisi data, false
 * untuk PATCH/DELETE yang mungkin mengembalikan body kosong.
 */
async function sbFetch<T>(
  pathname: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T> {
  const cfg = sbConfig();
  if (!cfg) throw new StoreError("BACKEND_UNAVAILABLE", "Supabase belum dikonfigurasi.");

  let res: Response;
  try {
    res = await fetch(`${cfg.base}/rest/v1${pathname}`, {
      ...init,
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (err) {
    throw new StoreError(
      "BACKEND_UNAVAILABLE",
      `Supabase tidak bisa dihubungi: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = await res.text();

  if (!res.ok) {
    // 23505 = unique violation (email sudah ada). PostgREST mengirim 409.
    if (res.status === 409 || text.includes("23505")) {
      throw new StoreError("EMAIL_TAKEN", "Email sudah terdaftar.");
    }
    throw new StoreError(
      "BACKEND_ERROR",
      `Supabase ${res.status} ${pathname}: ${text.slice(0, 240)}`,
    );
  }

  return (text ? JSON.parse(text) : []) as T;
}

type SbUserRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  roles: string[] | null;
  primary_role: string;
  status: string;
  password_hash: string;
  password_salt: string;
  created_at_ms: number | string;
  last_login_at_ms: number | string | null;
  updated_at_ms: number | string;
};

function num(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fromRow(row: SbUserRow): StoredUser {
  const roles = (row.roles ?? []).filter(Boolean) as Role[];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    roles: roles.length ? roles : ["CUSTOMER"],
    primaryRole: (row.primary_role as Role) ?? "CUSTOMER",
    status: (row.status as UserStatus) ?? "ACTIVE",
    createdAt: num(row.created_at_ms) ?? 0,
    lastLoginAt: num(row.last_login_at_ms),
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    updatedAt: num(row.updated_at_ms) ?? 0,
  };
}

function toRow(user: StoredUser): SbUserRow {
  return {
    id: user.id,
    email: user.email.toLowerCase(),
    name: user.name,
    phone: user.phone,
    roles: user.roles,
    primary_role: user.primaryRole,
    status: user.status,
    password_hash: user.passwordHash,
    password_salt: user.passwordSalt,
    created_at_ms: user.createdAt,
    last_login_at_ms: user.lastLoginAt,
    updated_at_ms: user.updatedAt,
  };
}

/** Cocokkan filter PostgREST dengan escape minimal (nilai email/id kita). */
function sbEq(value: string): string {
  return `eq.${encodeURIComponent(value)}`;
}

let sbSeeded: Promise<void> | null = null;

/**
 * Isi akun awal kalau tabel masih kosong.
 *
 * Idempoten: `on_conflict=email` + `resolution=ignore-duplicates`, jadi dua
 * instance yang cold-start bersamaan tidak saling menimpa atau melempar
 * error. Dijalankan sekali per proses (promise di-cache), bukan per request.
 */
async function sbEnsureSeed(): Promise<void> {
  if (sbSeeded) return sbSeeded;
  sbSeeded = (async () => {
    const probe = await sbFetch<Array<{ id: string }>>(
      `/${SB_TABLE}?select=id&limit=1`,
    );
    if (probe.length > 0) return;
    await sbFetch<SbUserRow[]>(`/${SB_TABLE}?on_conflict=email`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(buildSeed().map(toRow)),
    });
  })().catch((err) => {
    // Jangan racuni cache: percobaan berikutnya boleh mengulang.
    sbSeeded = null;
    throw err;
  });
  return sbSeeded;
}

async function sbList(): Promise<StoredUser[]> {
  await sbEnsureSeed();
  const rows = await sbFetch<SbUserRow[]>(
    `/${SB_TABLE}?select=*&order=created_at_ms.asc`,
  );
  return rows.map(fromRow);
}

async function sbFindByEmail(email: string): Promise<StoredUser | null> {
  await sbEnsureSeed();
  const rows = await sbFetch<SbUserRow[]>(
    `/${SB_TABLE}?select=*&email=${sbEq(email.trim().toLowerCase())}&limit=1`,
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

async function sbFindById(id: string): Promise<StoredUser | null> {
  const rows = await sbFetch<SbUserRow[]>(
    `/${SB_TABLE}?select=*&id=${sbEq(id)}&limit=1`,
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

async function sbPatch(id: string, patch: Partial<SbUserRow>): Promise<boolean> {
  const rows = await sbFetch<SbUserRow[]>(`/${SB_TABLE}?id=${sbEq(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return rows.length > 0;
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

export function storeBackend(): StoreBackend {
  if (sbConfig()) return "supabase";
  if (kvConfig()) return "kv";
  return resolveFilePath()?.backend ?? "memory";
}

export async function listUsers(): Promise<StoredUser[]> {
  if (sbConfig()) {
    const users = await sbList();
    return [...users].sort((a, b) => a.createdAt - b.createdAt);
  }
  const users = await load();
  return [...users].sort((a, b) => a.createdAt - b.createdAt);
}

export async function findByEmail(email: string): Promise<StoredUser | null> {
  if (sbConfig()) return sbFindByEmail(email);
  const users = await load();
  const needle = email.trim().toLowerCase();
  return users.find((u) => u.email.toLowerCase() === needle) ?? null;
}

export async function findById(id: string): Promise<StoredUser | null> {
  if (sbConfig()) return sbFindById(id);
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
  const email = input.email.trim().toLowerCase();
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

  if (sbConfig()) {
    // INSERT, bukan SELECT-lalu-INSERT: indeks unik di `email` yang menjadi
    // penjaga terakhir saat dua pendaftaran bersamaan memakai email sama.
    const rows = await sbFetch<SbUserRow[]>(`/${SB_TABLE}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(toRow(user)),
    });
    return rows[0] ? fromRow(rows[0]) : user;
  }

  const users = await load();
  if (users.some((u) => u.email.toLowerCase() === email)) {
    throw new StoreError("EMAIL_TAKEN", "Email sudah terdaftar.");
  }
  const next = [...users, user];
  await persist(next);
  return user;
}

export async function touchLogin(id: string): Promise<void> {
  const now = Date.now();
  if (sbConfig()) {
    await sbPatch(id, { last_login_at_ms: now, updated_at_ms: now });
    return;
  }
  const users = await load();
  const next = users.map((u) =>
    u.id === id ? { ...u, lastLoginAt: now, updatedAt: now } : u
  );
  await persist(next);
}

export async function updateProfile(
  id: string,
  patch: { name?: string; phone?: string | null }
): Promise<StoredUser | null> {
  if (sbConfig()) {
    const current = await sbFindById(id);
    if (!current) return null;
    const nextName = patch.name?.trim() || current.name;
    const nextPhone =
      patch.phone === undefined ? current.phone : patch.phone?.trim() || null;
    const ok = await sbPatch(id, {
      name: nextName,
      phone: nextPhone,
      updated_at_ms: Date.now(),
    });
    if (!ok) return null;
    return { ...current, name: nextName, phone: nextPhone, updatedAt: Date.now() };
  }

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
  if (sbConfig()) {
    return sbPatch(id, { status, updated_at_ms: Date.now() });
  }
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
  if (sbConfig()) {
    return sbPatch(id, {
      roles,
      primary_role: roles[0],
      updated_at_ms: Date.now(),
    });
  }
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
  if (sbConfig()) {
    const rows = await sbFetch<Array<{ roles: string[] | null }>>(
      `/${SB_TABLE}?select=roles`,
    );
    const byRole: Record<string, number> = {};
    for (const row of rows) {
      for (const r of row.roles ?? []) byRole[r] = (byRole[r] ?? 0) + 1;
    }
    return { total: rows.length, byRole };
  }

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