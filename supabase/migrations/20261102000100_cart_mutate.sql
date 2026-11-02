-- =====================================================================
--  OSR Webstore — satu round-trip per mutasi keranjang
--  Migrasi: 20261102000100_cart_mutate.sql
--
--  MASALAH
--    Sebelumnya setiap mutasi keranjang mengirim DUA permintaan ke Supabase:
--      POST /rest/v1/rpc/osr_cart_add      (tulis)
--      GET  /rest/v1/osr_cart?select=...   (baca ulang untuk respons API)
--    Untuk POST /api/cart bahkan TIGA, karena route perlu membaca keranjang
--    lebih dulu untuk memvalidasi total stok.
--
--  SOLUSI
--    Satu fungsi `osr_cart_mutate(p_owner, p_op, p_sku, p_qty)` yang
--    melakukan mutasi DAN mengembalikan isi keranjang terbaru sebagai jsonb.
--    Aplikasi tidak perlu SELECT susulan: round-trip per mutasi = 1.
--
--  Kompleksitas
--    Biaya = O(1) terhadap jumlah baris keranjang: satu statement tulis,
--    satu agregasi jsonb_agg untuk baris keranjang pemilik itu saja.
--    Tidak ada loop query per SKU (bukan N+1).
--
--  KOMPATIBILITAS
--    Fungsi lama (osr_cart_add/set/remove/clear) TIDAK dihapus supaya
--    deployment lama tetap jalan bila rilis ini di-rollback.
-- =====================================================================

create or replace function public.osr_cart_mutate(
  p_owner text,
  p_op    text,
  p_sku   text default null,
  p_qty   integer default 1
) returns jsonb
language plpgsql as $$
declare
  v_cart uuid;
  v_out  jsonb;
begin
  if p_op not in ('add', 'set', 'remove', 'clear') then
    raise exception 'op tidak dikenal: %', p_op;
  end if;

  -- Pastikan baris keranjang ada (sekali upsert, bukan baca-lalu-tulis).
  insert into public.osr_cart (owner_id, status)
  values (p_owner, 'active')
  on conflict (owner_id) do update
    set status     = 'active',
        updated_at = now(),
        expires_at = now() + interval '30 days'
  returning id into v_cart;

  if p_op = 'add' then
    insert into public.osr_cart_item (cart_id, sku, qty)
    values (v_cart, p_sku, least(greatest(coalesce(p_qty, 1), 1), 99))
    on conflict (cart_id, sku) do update
      set qty        = least(99, public.osr_cart_item.qty + excluded.qty),
          updated_at = now();

  elsif p_op = 'set' then
    if coalesce(p_qty, 0) <= 0 then
      delete from public.osr_cart_item where cart_id = v_cart and sku = p_sku;
    else
      update public.osr_cart_item
         set qty = least(greatest(p_qty, 1), 99)
       where cart_id = v_cart
         and sku = p_sku;
    end if;
    update public.osr_cart set updated_at = now() where id = v_cart;

  elsif p_op = 'remove' then
    delete from public.osr_cart_item where cart_id = v_cart and sku = p_sku;
    update public.osr_cart set updated_at = now() where id = v_cart;

  else -- clear
    delete from public.osr_cart_item where cart_id = v_cart;
    update public.osr_cart set updated_at = now() where id = v_cart;
  end if;

  -- Satu agregasi untuk seluruh isi keranjang: O(n) baris milik satu pemilik,
  -- bukan n query.
  select coalesce(
           jsonb_agg(jsonb_build_object('sku', sku, 'qty', qty) order by sku),
           '[]'::jsonb)
    into v_out
    from public.osr_cart_item
   where cart_id = v_cart;

  return v_out;
end $$;

-- Sama seperti RPC keranjang lain: hanya service_role yang boleh mengeksekusi.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.osr_cart_mutate(text, text, text, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.osr_cart_mutate(text, text, text, integer) from authenticated';
  end if;
end $$;