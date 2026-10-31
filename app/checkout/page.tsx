import type { Metadata } from "next";
import { CheckoutForm } from "@/components/CheckoutForm";
import { CheckoutGate } from "@/components/CheckoutGate";
import { optionalSession } from "@/lib/auth/page-guard";

export const metadata: Metadata = { title: "Checkout — Octarine" };
export const dynamic = "force-dynamic";

/**
 * Halaman checkout.
 *
 * Dua keadaan, satu URL:
 *   - belum masuk → gerbang masuk (isi keranjang tetap terlihat di kanan)
 *   - sudah masuk → form pengiriman & pembayaran
 *
 * Sengaja TIDAK `redirect("/login")`: pengguna yang baru mengisi keranjang
 * perlu melihat bahwa barangnya tidak hilang sebelum memutuskan masuk.
 * Penjagaan sebenarnya tetap di `POST /api/orders` (401 tanpa sesi), jadi
 * melewati tampilan ini pun tidak bisa membuat pesanan.
 */
export default function CheckoutPage() {
  const session = optionalSession();

  if (!session) {
    return <CheckoutGate />;
  }

  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Checkout</p>
        <h1 className="mt-2 font-display text-4xl">Pengiriman &amp; Pembayaran</h1>
      </div>
      <div className="mt-8">
        <CheckoutForm />
      </div>
    </div>
  );
}
