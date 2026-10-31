-- =====================================================================
--  OSR Webstore — Keranjang tamu (guest cart) + penggabungan saat login
--  Migrasi: 20261031000300_cart_guest.sql
--
--  Perubahan kebijakan (menyamakan perilaku octarine.co.id):
--    SEBELUM: keranjang hanya untuk pengguna yang sudah masuk (401).
--    SEKARANG: tamu boleh memasukkan barang dan mengubah jumlahnya;
--              masuk baru diwajibkan saat checkout.
--
--  Konsekuensi skema: `owner_id` tidak lagi selalu uid pengguna. Bentuknya:
--
--    <uid sesi>        → keranjang pengguna (data lama tetap sah)
--    guest:<uuid-v4>   → keranjang tamu, cookie `osr_guest` bertanda tangan
--
--  Satu-satunya perubahan logika yang dibutuhkan di database adalah
--  PENGGABUNGAN: saat tamu masuk, isi keranjang tamunya harus pindah ke
--  keranjang akun tanpa kehilangan barang. Dikerjakan dalam satu fungsi
--  plpgsql supaya tidak ada jendela waktu di mana barang sudah dihapus dari
--  keranjang tamu tetapi belum masuk ke keranjang akun.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Gabungkan keranjang tamu → keranjang pengguna
--
--  Aturan gabung:
--    * qty dijumlahkan, lalu dijepit ke 99 (batas satu baris).
--    * SKU yang hanya ada di salah satu sisi tetap dipertahankan.
--    * Keranjang sumber (tamu) dihapus setelah isinya dipindahkan; baris
--      item-nya ikut terhapus lewat ON DELETE CASCADE.
--    * Kalau p_from = p_to atau salah satunya kosong, tidak terjadi apa-apa.
--
--  Return: jumlah SKU yang ikut berpindah (0 kalau tidak ada).
-- ---------------------------------------------------------------------
create or replace function public.osr_cart_merge(
  p_from text,
  p_to   text
) returns integer
language plpgsql as $$
declare
  v_src     uuid;
  v_dst     uuid;
  v_moved   integer := 0;
begin
  if p_from is null or p_to is null or p_from = '' or p_to = '' or p_from = p_to then
    return 0;
  end if;

  select id into v_src from public.osr_cart where owner_id = p_from;
  if v_src is null then
    return 0;  -- tamu tidak punya keranjang: tidak ada yang perlu digabung
  end if;

  -- Pastikan keranjang tujuan ada.
  insert into public.osr_cart (owner_id, status)
  values (p_to, 'active')
  on conflict (owner_id) do update
    set status     = 'active',
        updated_at = now(),
        expires_at = now() + interval '30 days'
  returning id into v_dst;

  -- Pindahkan item: qty dijumlahkan, dijepit 99.
  with src_items as (
    select sku, qty from public.osr_cart_item where cart_id = v_src
  ), moved as (
    insert into public.osr_cart_item (cart_id, sku, qty)
    select v_dst, src_items.sku, src_items.qty from src_items
    on conflict (cart_id, sku) do update
      set qty        = least(99, public.osr_cart_item.qty + excluded.qty),
          updated_at = now()
    returning 1
  )
  select count(*) into v_moved from moved;

  -- Bersihkan keranjang tamu (item ikut terhapus via cascade).
  delete from public.osr_cart where id = v_src;

  update public.osr_cart set updated_at = now() where id = v_dst;

  return v_moved;
end $$;

revoke all on function public.osr_cart_merge(text, text) from public;

-- ---------------------------------------------------------------------
--  2. Kebersihan keranjang tamu
--
--  `osr_cart_reap()` versi 00100 hanya menghapus keranjang kosong yang lewat
--  30 hari. Keranjang tamu yang ditinggalkan (masih berisi barang) juga perlu
--  dibuang, karena tidak ada pemilik yang bisa membersihkannya sendiri.
--  Keranjang pengguna TIDAK disentuh di sini — isinya milik akun.
-- ---------------------------------------------------------------------
create or replace function public.osr_cart_reap()
returns integer
language plpgsql as $$
declare
  v_n integer;
begin
  delete from public.osr_cart
   where expires_at < now()
     and (
       owner_id like 'guest:%'                       -- tamu: apa pun isinya
       or id not in (select cart_id from public.osr_cart_item)  -- pengguna: hanya yang kosong
     );
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.osr_cart_reap() from public;

-- ---------------------------------------------------------------------
--  3. Indeks bantu pembersihan
-- ---------------------------------------------------------------------
create index if not exists osr_cart_guest_idx
  on public.osr_cart (owner_id)
  where owner_id like 'guest:%';

comment on column public.osr_cart.owner_id is
  'uid sesi webstore, atau guest:<uuid> untuk keranjang tamu (lihat lib/cart-owner.ts)';
