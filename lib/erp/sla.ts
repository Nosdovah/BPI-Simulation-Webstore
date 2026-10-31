import { ERP_ENDPOINTS, postJson, resolveErpConfig } from "./pull.mjs";

/* Diekspor ulang supaya route (yang tidak bisa meng-import `*.mjs` lewat alias
 * `@/`) cukup bergantung pada modul ini. */
export { resolveErpConfig };

/**
 * Monitor order terbuka + penyapu `sent_at` (temuan C-07, QA pass ke-8).
 *
 * MASALAH
 *   ERP punya `POST /api/to-be/reconcile-orders`, tetapi tidak ada pemanggil
 *   terjadwal. Akibatnya 15 order berstatus terbuka menumpuk tanpa jejak kirim,
 *   12 di antaranya > 2 hari (tertua 45,7 hari). Cacatnya bukan "tidak ada
 *   alat", melainkan "tidak ada yang menyalakan alat" — dan tidak ada satu pun
 *   angka yang bisa dipakai untuk mengawasi keadaan itu dari luar ERP.
 *
 * PENDEKATAN
 *   Fungsi ini adalah satu-satunya tempat angka SLA dihitung, supaya cron,
 *   route, dan laporan QA memakai definisi yang sama (tidak ada dua kebenaran).
 *   Ia hanya membaca + memanggil endpoint resmi ERP; tidak pernah menulis SQL.
 */

export const OPEN_STATUSES = [
  "pending",
  "paid",
  "process",
  "packing",
  "picking",
  "packed",
] as const;

const OPEN = new Set<string>(OPEN_STATUSES);

export type ErpOrderRow = {
  reference_no?: string;
  status?: string;
  order_at?: string;
  sent_at?: string | null;
  process_at?: string | null;
};

export type SlaSummary = {
  fetched_at: string;
  orders_total: number;
  by_status: Record<string, number>;
  open: number;
  without_sent_at: number;
  older_than_2d: number;
  oldest_days: number | null;
  stalled: Array<{ ref: string | null; status: string | null; age_days: number | null }>;
  sla_ok: boolean;
};

export function ageDays(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 86_400_000;
}

/** Baca seluruh order lewat paginasi resmi ERP (100/halaman, maks 20 halaman). */
export async function readAllOrders(
  cfg: ReturnType<typeof resolveErpConfig>,
): Promise<ErpOrderRow[]> {
  const out: ErpOrderRow[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const json = await postJson(cfg, ERP_ENDPOINTS.ordersPage, { page, length: 100 });
    const rows = ((json as { data?: ErpOrderRow[] })?.data ?? []) as ErpOrderRow[];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

export function summarizeSla(orders: ErpOrderRow[]): SlaSummary {
  const byStatus: Record<string, number> = {};
  for (const o of orders) {
    const s = (o.status ?? "unknown").toLowerCase();
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }

  const open = orders.filter((o) => OPEN.has((o.status ?? "").toLowerCase()));
  const withoutSent = open.filter((o) => !o.sent_at);
  const ages = withoutSent
    .map((o) => ageDays(o.order_at))
    .filter((d): d is number => d !== null);

  const stalled = withoutSent
    .map((o) => ({
      ref: o.reference_no ?? null,
      status: o.status ?? null,
      age_days: ageDays(o.order_at),
    }))
    .filter((s) => (s.age_days ?? 0) > 2)
    .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0))
    .slice(0, 10);

  return {
    fetched_at: new Date().toISOString(),
    orders_total: orders.length,
    by_status: byStatus,
    open: open.length,
    without_sent_at: withoutSent.length,
    older_than_2d: ages.filter((d) => d > 2).length,
    oldest_days: ages.length ? Math.round(Math.max(...ages) * 10) / 10 : null,
    stalled,
    sla_ok: withoutSent.length === 0,
  };
}

/** Panggil penyapu resmi ERP. Mengembalikan jumlah `sent_at` yang diisi. */
export async function reconcileSentAt(
  cfg: ReturnType<typeof resolveErpConfig>,
): Promise<{ filled: number | null; error: string | null }> {
  try {
    const res = await postJson(cfg, ERP_ENDPOINTS.reconcileOrders, {});
    const n = Number((res as { data?: { sent_at_filled?: number } })?.data?.sent_at_filled);
    return { filled: Number.isFinite(n) ? n : null, error: null };
  } catch (err) {
    return { filled: null, error: err instanceof Error ? err.message : String(err) };
  }
}