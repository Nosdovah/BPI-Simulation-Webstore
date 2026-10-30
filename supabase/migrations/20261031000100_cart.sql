-- =====================================================================
--  OSR Webstore — Keranjang server-side (Supabase / Postgres)
--  Migrasi: 20261031000100_cart.sql
--
--  Kenapa di server, bukan localStorage:
--    * isi keranjang tidak bisa dimanipulasi klien (harga & stok dihitung
--      ulang di server setiap kali dibaca),
--    * satu akun = satu keranjang, lintas perangkat dan lintas instance
--      serverless,
--    * keranjang bisa dipakai sebagai titik validasi stok (anti-oversell)
--      sebelum checkout menyentuh Jalur B.
--
--  KEPEMILIKAN DATA
--    owner_id = uid sesi webstore (lib/auth/session.ts), BUKAN auth.users
--    Supabase. Webstore memakai sesi HMAC sendiri, jadi RLS berbasis
--    auth.uid() tidak berlaku di sini.
--
--  KEAMANAN
--    RLS dinyalakan dan TIDAK ada policy sama sekali. Artinya: anon key
--    tidak bisa membaca/menulis apa pun. Hanya service_role (dipakai di
--    route handler server-side, setelah requireSession()) yang menembus
--    RLS. Kunci service_role TIDAK boleh muncul di bundle klien.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  1. Tabel
-- ---------------------------------------------------------------------
create table if not exists public.osr_cart (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null unique,
  status      text not null default 'active'
              check (status in ('active', 'converted', 'expired')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days'
);

create table if not exists public.osr_cart_item (
  cart_id     uuid not null references public.osr_cart(id) on delete cascade,
  sku         text not null,
  qty         integer not null check (qty between 1 and 99),
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (cart_id, sku)
);

create index if not exists osr_cart_item_cart_idx on public.osr_cart_item (cart_id);
create index if not exists osr_cart_expires_idx   on public.osr_cart (expires_at);

-- ---------------------------------------------------------------------
--  2. Trigger updated_at
-- ---------------------------------------------------------------------
create or replace function public.osr_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists osr_cart_touch on public.osr_cart;
create trigger osr_cart_touch
  before update on public.osr_cart
  for each row execute function public.osr_touch_updated_at();

drop trigger if exists osr_cart_item_touch on public.osr_cart_item;
create trigger osr_cart_item_touch
  before update on public.osr_cart_item
  for each row execute function public.osr_touch_updated_at();

-- ---------------------------------------------------------------------
--  3. RPC — operasi atomik
--
--  Dipakai supaya "tambah barang" tidak jadi baca-ubah-tulis di aplikasi.
--  Dua tab yang menekan Tambah bersamaan akan tetap menghasilkan angka
--  yang benar, karena penambahan qty terjadi di dalam satu statement SQL.
-- ---------------------------------------------------------------------
create or replace function public.osr_cart_add(
  p_owner text,
  p_sku   text,
  p_qty   integer default 1
) returns uuid
language plpgsql as $$
declare
  v_cart uuid;
  v_qty  integer := least(greatest(coalesce(p_qty, 1), 1), 99);
begin
  insert into public.osr_cart (owner_id, status)
  values (p_owner, 'active')
  on conflict (owner_id) do update
    set status     = 'active',
        updated_at = now(),
        expires_at = now() + interval '30 days'
  returning id into v_cart;

  insert into public.osr_cart_item (cart_id, sku, qty)
  values (v_cart, p_sku, v_qty)
  on conflict (cart_id, sku) do update
    set qty        = least(99, public.osr_cart_item.qty + excluded.qty),
        updated_at = now();

  return v_cart;
end $$;

-- qty <= 0 berarti hapus baris.
create or replace function public.osr_cart_set(
  p_owner text,
  p_sku   text,
  p_qty   integer
) returns void
language plpgsql as $$
declare
  v_cart uuid;
begin
  select id into v_cart from public.osr_cart where owner_id = p_owner;
  if v_cart is null then
    return;
  end if;

  if coalesce(p_qty, 0) <= 0 then
    delete from public.osr_cart_item where cart_id = v_cart and sku = p_sku;
  else
    update public.osr_cart_item
       set qty = least(p_qty, 99)
     where cart_id = v_cart
       and sku = p_sku;
  end if;

  update public.osr_cart set updated_at = now() where id = v_cart;
end $$;

-- Hapus satu SKU (dipakai tombol "buang").
create or replace function public.osr_cart_remove(
  p_owner text,
  p_sku   text
) returns void
language plpgsql as $$
declare
  v_cart uuid;
begin
  select id into v_cart from public.osr_cart where owner_id = p_owner;
  if v_cart is null then
    return;
  end if;
  delete from public.osr_cart_item where cart_id = v_cart and sku = p_sku;
  update public.osr_cart set updated_at = now() where id = v_cart;
end $$;

-- Kosongkan isi keranjang tetapi pertahankan barisnya (jejak updated_at).
create or replace function public.osr_cart_clear(p_owner text)
returns void
language plpgsql as $$
declare
  v_cart uuid;
begin
  select id into v_cart from public.osr_cart where owner_id = p_owner;
  if v_cart is null then
    return;
  end if;
  delete from public.osr_cart_item where cart_id = v_cart;
  update public.osr_cart set updated_at = now() where id = v_cart;
end $$;

-- Tandai keranjang sudah menjadi order (dipanggil setelah Jalur B sukses).
create or replace function public.osr_cart_consume(p_owner text)
returns void
language plpgsql as $$
declare
  v_cart uuid;
begin
  select id into v_cart from public.osr_cart where owner_id = p_owner;
  if v_cart is null then
    return;
  end if;
  delete from public.osr_cart_item where cart_id = v_cart;
  update public.osr_cart
     set status = 'active',
         updated_at = now(),
         expires_at = now() + interval '30 days'
   where id = v_cart;
end $$;

-- ---------------------------------------------------------------------
--  4. RLS — tutup total untuk anon & authenticated
-- ---------------------------------------------------------------------
alter table public.osr_cart      enable row level security;
alter table public.osr_cart_item enable row level security;

-- Tanpa policy, RLS = deny all. Ini disengaja: satu-satunya jalan masuk
-- adalah service_role lewat route handler /api/cart.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.osr_cart, public.osr_cart_item from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.osr_cart, public.osr_cart_item from authenticated';
  end if;
end $$;

revoke all on function public.osr_cart_add(text, text, integer)      from public;
revoke all on function public.osr_cart_set(text, text, integer)      from public;
revoke all on function public.osr_cart_remove(text, text)            from public;
revoke all on function public.osr_cart_clear(text)                   from public;
revoke all on function public.osr_cart_consume(text)                 from public;

-- ---------------------------------------------------------------------
--  5. Housekeeping (opsional, jalankan manual atau lewat pg_cron)
--     Keranjang yang lewat 30 hari dianggap kedaluwarsa.
-- ---------------------------------------------------------------------
create or replace function public.osr_cart_reap()
returns integer
language plpgsql as $$
declare
  v_n integer;
begin
  delete from public.osr_cart
   where expires_at < now()
     and id not in (select cart_id from public.osr_cart_item);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- select public.osr_cart_reap();