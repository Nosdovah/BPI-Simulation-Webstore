import { cookies } from "next/headers";
import { MODE_COOKIE, parseMode } from "@/lib/state";
import { CheckoutForm } from "@/components/CheckoutForm";

export default function CheckoutPage() {
  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);

  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Checkout</p>
        <h1 className="mt-2 font-display text-4xl">Pengiriman &amp; Pembayaran</h1>
      </div>
      <div className="mt-8">
        <CheckoutForm mode={mode} />
      </div>
    </div>
  );
}