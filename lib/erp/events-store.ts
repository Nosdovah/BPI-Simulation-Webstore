import { sbFetch, sbReady } from "../supabase";

/**
 * Penyimpanan event ERP (Jalur C-push) + cache status order.
 *
 * Kenapa tidak cukup memori proses: Vercel serverless mendaur ulang instance
 * tanpa pemberitahuan. Event yang hanya hidup di variabel modul akan hilang, dan
 * yang tersisa hanyalah "push terlihat sukses" tanpa jejak yang bisa diaudit.
 * Setiap event yang lolos verifikasi signature ditulis ke Postgres, sehingga
 * `/api/webhooks/erp/events` bisa menjawab "apa yang sebenarnya diterima" juga
 * setelah cold start.
 */

export type ErpEventInput = {
  eventId: string;
  event: string;
  ref: string | null;
  payload: unknown;
  signatureOk: boolean;
  signatureVia: string | null;
};

export type ErpEventRow = {
  event_id: string;
  event: string;
  ref: string | null;
  signature_ok: boolean;
  signature_via: string | null;
  received_at_ms: number;
};

export type OrderStatusRow = {
  ref: string;
  status: string;
  tracking_no: string | null;
  courier: string | null;
  updated_at_ms: number;
};

export type IngestResult = {
  stored: boolean;
  inserted: boolean;
  duplicate: boolean;
  status: string | null;
  backend: "supabase" | "memory";
};

/* ------------------------------------------------------------------ memory ---
 * Cadangan saat Supabase belum dikonfigurasi (dev lokal). Sengaja diberi batas
 * 300 event supaya tidak tumbuh tanpa akhir.
 */
const g = globalThis as unknown as {
  __osrErpEvents?: ErpEventRow[];
  __osrOrderStatus?: Map<string, OrderStatusRow>;
};

function memoryEvents(): ErpEventRow[] {
  if (!g.__osrErpEvents) g.__osrErpEvents = [];
  return g.__osrErpEvents;
}

function memoryStatus(): Map<string, OrderStatusRow> {
  if (!g.__osrOrderStatus) g.__osrOrderStatus = new Map();
  return g.__osrOrderStatus;
}

/* ------------------------------------------------------------------ ingest --- */

export async function ingestErpEvent(input: ErpEventInput): Promise<IngestResult> {
  if (sbReady()) {
    const result = await sbFetch<{ inserted: boolean; duplicate: boolean; status: string | null }>(
      "/rest/v1/rpc/osr_erp_event_ingest",
      {
        method: "POST",
        body: JSON.stringify({
          p_event_id: input.eventId,
          p_event: input.event,
          p_ref: input.ref,
          p_payload: input.payload,
          p_signature_ok: input.signatureOk,
          p_signature_via: input.signatureVia,
        }),
      },
    );
    return {
      stored: true,
      inserted: Boolean(result?.inserted),
      duplicate: Boolean(result?.duplicate),
      status: result?.status ?? null,
      backend: "supabase",
    };
  }

  const events = memoryEvents();
  const dup = events.some((e) => e.event_id === input.eventId);
  if (!dup) {
    events.unshift({
      event_id: input.eventId,
      event: input.event,
      ref: input.ref,
      signature_ok: input.signatureOk,
      signature_via: input.signatureVia,
      received_at_ms: Date.now(),
    });
    if (events.length > 300) events.length = 300;

    const data = (input.payload as { data?: Record<string, unknown> })?.data ?? {};
    const status = typeof data.status === "string" ? data.status.toLowerCase() : null;
    if (input.ref && input.event.startsWith("order.") && status) {
      memoryStatus().set(input.ref, {
        ref: input.ref,
        status,
        tracking_no: (data.tracking_no as string) ?? (data.awb as string) ?? null,
        courier: (data.courier as string) ?? (data.courier_label as string) ?? null,
        updated_at_ms: Date.now(),
      });
    }
    return { stored: true, inserted: true, duplicate: false, status, backend: "memory" };
  }
  return { stored: true, inserted: false, duplicate: true, status: null, backend: "memory" };
}

/* -------------------------------------------------------------------- read --- */

export async function readErpEvents(
  limit = 50,
): Promise<{ backend: string; events: ErpEventRow[]; returned: number }> {
  const safe = Math.max(1, Math.min(limit, 200));
  if (sbReady()) {
    const rows =
      (await sbFetch<ErpEventRow[]>(
        `/rest/v1/osr_erp_event?select=event_id,event,ref,signature_ok,signature_via,received_at_ms&order=received_at_ms.desc&limit=${safe}`,
        { soft: true },
      )) ?? [];
    return { backend: "supabase", events: rows, returned: rows.length };
  }
  const rows = memoryEvents().slice(0, safe);
  return { backend: "memory", events: rows, returned: rows.length };
}

/** Status order terakhir dari event push. Null = belum pernah menerima event. */
export async function readOrderStatus(ref: string): Promise<OrderStatusRow | null> {
  if (sbReady()) {
    const rows =
      (await sbFetch<OrderStatusRow[]>(
        `/rest/v1/osr_order_status?ref=eq.${encodeURIComponent(ref)}&select=ref,status,tracking_no,courier,updated_at_ms&limit=1`,
        { soft: true },
      )) ?? [];
    return rows[0] ?? null;
  }
  return memoryStatus().get(ref) ?? null;
}

export async function upsertOrderStatus(row: {
  ref: string;
  status: string;
  trackingNo?: string | null;
  courier?: string | null;
  payload?: unknown;
}): Promise<boolean> {
  const status = row.status.toLowerCase();
  if (sbReady()) {
    const res = await sbFetch<unknown>("/rest/v1/osr_order_status?on_conflict=ref", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        ref: row.ref,
        status,
        tracking_no: row.trackingNo ?? null,
        courier: row.courier ?? null,
        payload: row.payload ?? null,
        updated_at_ms: Date.now(),
      }),
      soft: true,
    });
    return res !== null;
  }
  memoryStatus().set(row.ref, {
    ref: row.ref,
    status,
    tracking_no: row.trackingNo ?? null,
    courier: row.courier ?? null,
    updated_at_ms: Date.now(),
  });
  return true;
}
