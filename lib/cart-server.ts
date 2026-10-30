import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CartLine } from "./types";

/**
 * Keranjang server-side — backend-agnostik.
 *
 * Tiga backend, dipilih otomatis:
 *
 *   supabase → tabel `osr_cart` + `osr_cart_item` (lihat
 *              supabase/migrations/20261031000100_cart.sql).
 *              Diakses lewat PostgREST (`/rest/v1/...` dan `/rest/v1/rpc/...`)
 *              memakai `fetch`, jadi tidak perlu menambah dependensi.
 *              WAJIB memakai service_role key: RLS tabel keranjang sengaja
 *              tidak punya policy, sehingga anon key ditolak total.
 *
 *   file     → `.data/cart.json` (lokal / VPS). Dipakai saat Supabase belum
 *              dikonfigurasi supaya `npm run dev` tetap jalan.
 *
 *   memory   → cadangan terakhir. Hilang saat proses mati.
 *
 * Kontraknya sama untuk ketiganya: pemanggil cukup mengirim `owner` (uid
 * sesi webstore) dan `sku`/`qty`. Tidak ada satu pun fungsi di sini yang
 * membaca cookie — otorisasi tetap tanggung jawab route handler.
 */

export type CartBackend = "supabase" | "file" | "memory";

export type CartMutation =
  | { op: "add"; sku: string; qty: number }
  | { op: "set"; sku: string; qty: number }
  | { op: "remove"; sku: string }
  | { op: "clear" };

const MAX_QTY = 99;
const MIN_QTY = 1;

/** Batasi kuantitas ke rentang yang sah. Nilai aneh dari klien tidak lolos. */
export function clampQty(qty: unknown, fallback = 1): number {
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_QTY, Math.max(MIN_QTY, n));
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

async function sbFetch<T>(
  pathname: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T | null> {
  const cfg = sbConfig();
  if (!cfg) throw new Error("Supabase belum dikonfigurasi");

  const res = await fetch(`${cfg.base}${pathname}`, {
    ...init,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} ${pathname}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : null;
}

type SbCartRow = {
  id: string;
  status: string;
  osr_cart_item: Array<{ sku: string; qty: number }> | null;
};

async function sbRead(owner: string): Promise<CartLine[]> {
  const q =
    `/rest/v1/osr_cart?owner_id=eq.${encodeURIComponent(owner)}` +
    `&select=id,status,osr_cart_item(sku,qty)&limit=1`;
  const rows = (await sbFetch<SbCartRow[]>(q)) ?? [];
  const row = rows[0];
  if (!row?.osr_cart_item) return [];
  return row.osr_cart_item
    .map((l) => ({ sku: String(l.sku), qty: clampQty(l.qty) }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

async function sbRpc(fn: string, body: Record<string, unknown>): Promise<void> {
  await sbFetch(`/rest/v1/rpc/${fn}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ==================================================================== *
 *  Backend: file / memori
 * ==================================================================== */

type FileShape = Record<string, { lines: CartLine[]; updatedAt: string }>;

let resolvedFile: { path: string; backend: CartBackend } | null | undefined;
const memoryStore = new Map<string, CartLine[]>();

function isWritableDir(dir: string): boolean {
  const probe = path.join(dir, `.probe-cart-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(probe, "ok", "utf8");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function resolveFile(): { path: string; backend: CartBackend } | null {
  if (resolvedFile !== undefined) return resolvedFile;

  const candidates: Array<{ path: string; backend: CartBackend }> = [
    { path: path.join(process.cwd(), ".data", "cart.json"), backend: "file" },
    { path: path.join("/tmp", "osr-data", "cart.json"), backend: "memory" },
  ];

  for (const c of candidates) {
    try {
      const dir = path.dirname(c.path);
      mkdirSync(dir, { recursive: true });
      if (!isWritableDir(dir)) continue;
      resolvedFile = c;
      return c;
    } catch {
      // coba kandidat berikutnya
    }
  }
  resolvedFile = null;
  return null;
}

function readFileStore(): FileShape {
  const target = resolveFile();
  if (!target) return {};
  if (!existsSync(target.path)) return {};
  try {
    return JSON.parse(readFileSync(target.path, "utf8")) as FileShape;
  } catch {
    return {};
  }
}

function writeFileStore(data: FileShape): void {
  const target = resolveFile();
  if (!target) return;
  try {
    writeFileSync(target.path, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // jatuh ke memori
    resolvedFile = null;
  }
}

/* ==================================================================== *
 *  Lapisan publik
 * ==================================================================== */

export function cartBackend(): CartBackend {
  if (sbConfig()) return "supabase";
  return resolveFile()?.backend ?? "memory";
}

export async function readCart(owner: string): Promise<CartLine[]> {
  if (sbConfig()) return sbRead(owner);
  const store = readFileStore();
  return store[owner]?.lines ?? memoryStore.get(owner) ?? [];
}

export async function mutateCart(
  owner: string,
  action: CartMutation,
): Promise<CartLine[]> {
  if (sbConfig()) {
    if (action.op === "add") {
      await sbRpc("osr_cart_add", { p_owner: owner, p_sku: action.sku, p_qty: clampQty(action.qty) });
    } else if (action.op === "set") {
      await sbRpc("osr_cart_set", { p_owner: owner, p_sku: action.sku, p_qty: clampQty(action.qty, 1) });
    } else if (action.op === "remove") {
      await sbRpc("osr_cart_remove", { p_owner: owner, p_sku: action.sku });
    } else {
      await sbRpc("osr_cart_clear", { p_owner: owner });
    }
    return sbRead(owner);
  }

  const store = readFileStore();
  const current = store[owner]?.lines ?? memoryStore.get(owner) ?? [];
  let lines: CartLine[] = current.map((l) => ({ ...l }));

  if (action.op === "add") {
    const qty = clampQty(action.qty);
    const found = lines.find((l) => l.sku === action.sku);
    if (found) found.qty = Math.min(MAX_QTY, found.qty + qty);
    else lines.push({ sku: action.sku, qty });
  } else if (action.op === "set") {
    const qty = clampQty(action.qty, 1);
    lines = lines.map((l) => (l.sku === action.sku ? { ...l, qty } : l));
  } else if (action.op === "remove") {
    lines = lines.filter((l) => l.sku !== action.sku);
  } else {
    lines = [];
  }

  lines.sort((a, b) => a.sku.localeCompare(b.sku));

  if (resolveFile()) {
    store[owner] = { lines, updatedAt: new Date().toISOString() };
    writeFileStore(store);
  } else {
    memoryStore.set(owner, lines);
  }
  return lines;
}

/** Dipanggil setelah order berhasil dibuat: kosongkan keranjang pemilik. */
export async function consumeCart(owner: string): Promise<void> {
  if (sbConfig()) {
    await sbRpc("osr_cart_consume", { p_owner: owner });
    return;
  }
  await mutateCart(owner, { op: "clear" });
}