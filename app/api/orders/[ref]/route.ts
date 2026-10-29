import { NextResponse } from "next/server";
import {
  applyErpLookup,
  deriveStatus,
  readOrderToken,
  recallOrder,
  rememberOrder,
} from "@/lib/orders";
import { fetchErpOrder, resolveErpOrderConfig } from "@/lib/erp/order.mjs";
import type { ErpOrderLookup } from "@/lib/erp/types";

export const dynamic = "force-dynamic";

/**
 * Cache pembacaan status ERP per order_ref.
 *
 * Halaman pelacakan menyegarkan tiap 4 detik; tanpa cache, satu pelanggan saja
 * sudah menghasilkan 15 request/menit ke ERP, dan ERP tidak punya endpoint
 * "get by ref" (daftar penuh yang harus disaring). TTL pendek (default 3 dtk)
 * sudah cukup untuk demo tanpa membebani ERP.
 */
type CacheEntry = { at: number; lookup: ErpOrderLookup };
const globalRef = globalThis as unknown as {
  __osrErpStatusCache?: Map<string, CacheEntry>;
};

function cache(): Map<string, CacheEntry> {
  if (!globalRef.__osrErpStatusCache) globalRef.__osrErpStatusCache = new Map();
  return globalRef.__osrErpStatusCache;
}

async function lookupWithCache(
  ref: string,
  ttlMs: number,
): Promise<{ lookup: ErpOrderLookup; cached: boolean }> {
  const map = cache();
  const hit = map.get(ref);
  if (hit && Date.now() - hit.at < ttlMs) {
    return { lookup: hit.lookup, cached: true };
  }
  const cfg = resolveErpOrderConfig();
  const lookup = await fetchErpOrder(cfg, ref);
  map.set(ref, { at: Date.now(), lookup });
  // Jaga ukuran cache: buang entri tertua kalau sudah terlalu banyak.
  if (map.size > 500) {
    const oldest = [...map.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) map.delete(oldest[0]);
  }
  return { lookup, cached: false };
}

/** GET /api/orders/[ref]?k=token — status + timeline (status dari ERP). */
export async function GET(
  request: Request,
  { params }: { params: { ref: string } },
) {
  const url = new URL(request.url);
  const token = url.searchParams.get("k");
  const order = recallOrder(params.ref) ?? readOrderToken(token);

  if (!order) {
    return NextResponse.json(
      { error: "ORDER_NOT_FOUND", message: "Order tidak ditemukan atau token tidak valid." },
      { status: 404 },
    );
  }

  /* Jalur B: tarik status terakhir dari ERP (Modul 4.2). */
  const cfg = resolveErpOrderConfig();
  let sync: { attempted: boolean; cached: boolean; found: boolean; error: string | null } = {
    attempted: false,
    cached: false,
    found: false,
    error: null,
  };

  if (cfg.mode === "push" && cfg.sync) {
    const erpRef = order.erp?.orderRef ?? order.ref;
    const { lookup, cached } = await lookupWithCache(erpRef, cfg.statusTtlMs);
    applyErpLookup(order, lookup);
    rememberOrder(order);
    sync = {
      attempted: true,
      cached,
      found: lookup.found,
      error: lookup.ok ? null : lookup.error ?? "gagal membaca ERP",
    };
  }

  const derived = deriveStatus(order);

  return NextResponse.json({
    ref: order.ref,
    status: derived.status,
    note: derived.note,
    trackingNo: derived.trackingNo,
    actorLast: order.actorLast,
    createdAt: order.createdAt,
    timeline: derived.timeline,
    items: order.items,
    totalIdr: order.totalIdr,
    customer: order.customer,
    shipping: order.shipping,
    erp: order.erp
      ? {
          contract: order.erp.contract,
          order_ref: order.erp.orderRef,
          erp_id: order.erp.erpId,
          raw_status: order.erp.rawStatus,
          tracking_no: order.erp.trackingNo,
          pushed_at: order.erp.pushedAt,
          last_sync_at: order.erp.lastSyncAt,
          last_sync_source: order.erp.lastSyncSource,
          error: order.erp.error,
        }
      : null,
    sync,
  });
}