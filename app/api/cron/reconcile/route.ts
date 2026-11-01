import { NextResponse } from "next/server";
import {
  readAllOrders,
  reconcileSentAt,
  resolveErpConfig,
  summarizeSla,
} from "@/lib/erp/sla";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/cron/reconcile — penyapu `sent_at` + monitor SLA order (C-07).
 *
 * Dipanggil otomatis oleh Vercel Cron (`vercel.json`, harian 01:00 UTC) atau
 * manual oleh QA:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<host>/api/cron/reconcile?dry=1     # hanya laporan
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<host>/api/cron/reconcile           # sapu + laporan
 *
 * `?dry=1` dipakai QA supaya pembacaan angka tidak ikut memutasi ERP.
 *
 * Tanpa secret, endpoint MENOLAK (503) — endpoint yang memutasi data tidak
 * boleh punya mode "terbuka karena lupa mengisi env".
 */
async function run(request: Request) {
  const expected = process.env.CRON_SECRET || process.env.OSR_CART_REAP_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_NOT_CONFIGURED", message: "CRON_SECRET belum diset di host ini." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const alt = request.headers.get("x-osr-cron-token") ?? "";
  if (bearer !== expected && alt !== expected) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const cfg = resolveErpConfig();

  const reconcile = dry
    ? { filled: null, stalled_marked: null, exceptions_open: null, sla_days: null, error: null }
    : await reconcileSentAt(cfg);

  let orders;
  try {
    orders = await readAllOrders(cfg);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERP_UNREACHABLE",
        message: err instanceof Error ? err.message : String(err),
        sent_at_filled: reconcile.filled,
      },
      { status: 502 },
    );
  }

  const sla = summarizeSla(orders);
  return NextResponse.json({
    ok: true,
    dry_run: dry,
    sent_at_filled: reconcile.filled,
    stalled_marked: reconcile.stalled_marked,
    exceptions_open: reconcile.exceptions_open,
    sla_days: reconcile.sla_days,
    reconcile_error: reconcile.error,
    ...sla,
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}