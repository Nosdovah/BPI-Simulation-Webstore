-- =====================================================================
--  OSR Webstore — Event masuk dari ERP (Jalur C-push) + cache status order
--  Migrasi: 20261031000400_erp_events.sql
--
--  Kenapa perlu tabel ini:
--    * Vercel serverless tidak punya memori bersama. Event push dari ERP yang
--      hanya disimpan di variabel proses hilang saat instance didaur ulang, dan
--      audit jadi tidak bisa dipertanggungjawabkan (temuan A-11/F-05).
--    * Status order juga disimpan di sini supaya pelacakan tetap hidup setelah
--      cold start tanpa bergantung pada `?k=<token>` (temuan C-06).
--
--  KEAMANAN
--    RLS menyala, TIDAK ada policy → anon key ditolak total. Hanya service_role
--    (route handler server-side) yang menulis. Signature HMAC diverifikasi di
--    route SEBELUM insert, jadi baris di sini sudah lolos verifikasi.
-- =====================================================================

create table if not exists public.osr_erp_event (
  event_id        text primary key,
  event           text not null,
  ref             text,
  signature_ok    boolean not null default false,
  signature_via   text,
  payload         jsonb not null,
  received_at_ms  bigint not null,
  received_at     timestamptz not null default now()
);

create index if not exists osr_erp_event_ref_idx on public.osr_erp_event (ref);
create index if not exists osr_erp_event_received_idx on public.osr_erp_event (received_at_ms desc);

alter table public.osr_erp_event enable row level security;

-- ---------------------------------------------------------------------
--  Cache status order terakhir (sumber: push ERP dan/atau pull on-demand).
--  `status` disimpan huruf kecil seperti enum ERP; UI yang meng-uppercase.
-- ---------------------------------------------------------------------
create table if not exists public.osr_order_status (
  ref             text primary key,
  status          text not null,
  tracking_no     text,
  courier         text,
  payload         jsonb,
  updated_at_ms   bigint not null,
  updated_at      timestamptz not null default now()
);

create index if not exists osr_order_status_updated_idx on public.osr_order_status (updated_at_ms desc);

alter table public.osr_order_status enable row level security;

-- ---------------------------------------------------------------------
--  1. Ingest event: satu event_id = satu baris. Idempotensi dijamin primary
--     key, bukan oleh kode klien (retry jaringan tidak boleh menggandakan).
--  2. Upsert status: hanya menang kalau lebih baru (updated_at_ms).
-- ---------------------------------------------------------------------
create or replace function public.osr_erp_event_ingest(
  p_event_id text,
  p_event    text,
  p_ref      text,
  p_payload  jsonb,
  p_signature_ok boolean default true,
  p_signature_via text default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  inserted boolean := false;
  v_status text;
begin
  insert into public.osr_erp_event (event_id, event, ref, signature_ok, signature_via, payload, received_at_ms)
  values (p_event_id, p_event, p_ref, coalesce(p_signature_ok, true), p_signature_via, p_payload, (extract(epoch from clock_timestamp()) * 1000)::bigint)
  on conflict (event_id) do nothing;
  inserted := found;

  if inserted and p_ref is not null and p_event like 'order.%' then
    v_status := lower(coalesce(p_payload -> 'data' ->> 'status', p_payload ->> 'status', ''));
    if v_status <> '' then
      insert into public.osr_order_status (ref, status, tracking_no, courier, payload, updated_at_ms)
      values (
        p_ref,
        v_status,
        coalesce(p_payload -> 'data' ->> 'tracking_no', p_payload -> 'data' ->> 'awb'),
        coalesce(p_payload -> 'data' ->> 'courier', p_payload -> 'data' ->> 'courier_label'),
        p_payload,
        (extract(epoch from clock_timestamp()) * 1000)::bigint
      )
      on conflict (ref) do update
        set status = excluded.status,
            tracking_no = coalesce(excluded.tracking_no, public.osr_order_status.tracking_no),
            courier = coalesce(excluded.courier, public.osr_order_status.courier),
            payload = excluded.payload,
            updated_at_ms = excluded.updated_at_ms,
            updated_at = now()
        where excluded.updated_at_ms >= public.osr_order_status.updated_at_ms;
    end if;
  end if;

  return jsonb_build_object(
    'inserted', inserted,
    'duplicate', not inserted,
    'event_id', p_event_id,
    'ref', p_ref,
    'status', v_status
  );
end;
$$;

-- Grant hanya ke service_role: anon tetap tidak punya akses.
revoke all on function public.osr_erp_event_ingest(text, text, text, jsonb, boolean, text) from public;
grant execute on function public.osr_erp_event_ingest(text, text, text, jsonb, boolean, text) to service_role;
