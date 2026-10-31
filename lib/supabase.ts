/**
 * Klien Supabase minimal (PostgREST) untuk server-side.
 *
 * Tidak memakai `@supabase/supabase-js`: yang dibutuhkan hanya REST + RPC, dan
 * `fetch` sudah tersedia di runtime Vercel. Menambah dependensi untuk itu
 * berarti menambah permukaan upgrade tanpa manfaat.
 *
 * WAJIB memakai `SUPABASE_SERVICE_ROLE_KEY`. Semua tabel OSR memakai RLS
 * deny-all (tidak ada policy), sehingga anon key ditolak total — itu disengaja:
 * satu-satunya pintu adalah route handler yang sudah memvalidasi sesi.
 */

export type SbConfig = { base: string; key: string };

export function sbConfig(): SbConfig | null {
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "")
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

export type SbInit = RequestInit & {
  headers?: Record<string, string>;
  /** `true` → kembalikan array `[]` kalau tabel kosong/belum ada (bukan throw) */
  soft?: boolean;
};

export async function sbFetch<T>(pathname: string, init: SbInit = {}): Promise<T | null> {
  const cfg = sbConfig();
  if (!cfg) return null;

  const { soft, ...rest } = init;
  const res = await fetch(`${cfg.base}${pathname}`, {
    ...rest,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    if (soft) {
      console.warn(`[supabase] ${res.status} ${pathname}: ${text.slice(0, 200)}`);
      return null;
    }
    throw new Error(`Supabase ${res.status} ${pathname}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : null;
}

export function sbReady(): boolean {
  return sbConfig() !== null;
}
