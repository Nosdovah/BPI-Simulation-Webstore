import { CheckoutForm } from "@/components/CheckoutForm";

export default function CheckoutPage() {
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