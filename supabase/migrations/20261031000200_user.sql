-- =====================================================================
--  OSR Webstore — Akun pengguna di Supabase (Postgres)
--  Migrasi: 20261031000200_user.sql
--
--  Kenapa pindah dari berkas/JSON ke Postgres:
--    * Vercel serverless tidak punya penyimpanan bersama. `.data/users.json`
--      hanya bisa ditulis di /tmp, dan /tmp hidup per-instance: user yang
--      mendaftar di instance A hilang begitu request berikutnya mendarat di
--      instance B, lalu muncul lagi saat instance A kebetulan dipakai.
--      Gejalanya: "registrasi sukses" tapi login berikutnya gagal.
--    * Satu tabel = satu kebenaran, lintas instance dan lintas deploy.
--
--  KEPEMILIKAN DATA
--    Tabel ini BUKAN auth.users Supabase. Webstore memakai sesi HMAC sendiri
--    (lib/auth/session.ts), jadi tidak ada Supabase Auth yang terlibat dan
--    RLS berbasis auth.uid() tidak berlaku.
--
--  KEAMANAN
--    RLS menyala dan TIDAK ada policy sama sekali → anon key ditolak total.
--    Hanya service_role (route handler server-side, setelah validasi sesi)
--    yang bisa menembus. Kolom password_hash tidak pernah keluar dari server:
--    seluruh respons API memakai toPublicUser().
--
--  HASH
--    scrypt (Node crypto), salt per user 16 byte hex, hash 64 byte hex.
--    Dua kolom terpisah supaya bisa dirotasi tanpa mengubah bentuk record.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Tabel
-- ---------------------------------------------------------------------
create table if not exists public.osr_user (
  id              text primary key,
  email           text not null,
  name            text not null,
  phone           text,
  roles           text[] not null default array['CUSTOMER']::text[],
  primary_role    text not null default 'CUSTOMER'
                  check (primary_role in
                    ('SUPER_ADMIN','ADMIN_KATALOG','ADMIN_ORDER','ADMIN_GUDANG','CUSTOMER')),
  status          text not null default 'ACTIVE'
                  check (status in ('ACTIVE','PENDING','SUSPENDED')),
  password_hash   text not null,
  password_salt   text not null,
  created_at_ms   bigint not null,
  last_login_at_ms bigint,
  updated_at_ms   bigint not null,
  created_at      timestamptz not null default now()
);

-- Email dinormalkan ke huruf kecil oleh aplikasi. Indeks unik HARUS berupa
-- kolom biasa (bukan `lower(email)`): PostgREST memakai `on_conflict=email`
-- untuk seed idempoten, dan ON CONFLICT tidak bisa menebak indeks ekspresi
-- (error 42P10 "no unique or exclusion constraint matching..."). CHECK di
-- bawah menjaga agar normalisasi itu tidak dilanggar dari sisi mana pun.
alter table public.osr_user
  drop constraint if exists osr_user_email_normalized;
alter table public.osr_user
  add constraint osr_user_email_normalized check (email = lower(email));

create unique index if not exists osr_user_email_uniq on public.osr_user (email);

create index if not exists osr_user_roles_idx on public.osr_user using gin (roles);
create index if not exists osr_user_created_idx on public.osr_user (created_at_ms);

comment on table public.osr_user is
  'Akun webstore OSR (sesi HMAC sendiri, bukan Supabase Auth). Hanya service_role.';
comment on column public.osr_user.password_hash is
  'scrypt hex 64 byte. Tidak pernah dikirim ke klien.';

-- ---------------------------------------------------------------------
--  2. RLS — tutup total untuk anon & authenticated
-- ---------------------------------------------------------------------
alter table public.osr_user enable row level security;

-- Tanpa policy, RLS = deny all. Disengaja.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.osr_user from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.osr_user from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------
--  3. Ringkasan per peran (dipakai panel admin, tanpa membaca hash)
-- ---------------------------------------------------------------------
create or replace view public.osr_user_summary
with (security_invoker = true) as
select
  u.id,
  u.email,
  u.name,
  u.phone,
  u.roles,
  u.primary_role,
  u.status,
  u.created_at_ms,
  u.last_login_at_ms,
  cardinality(u.roles) as role_count
from public.osr_user u;

revoke all on public.osr_user_summary from public;