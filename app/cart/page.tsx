import { CartView } from "@/components/CartView";

export default function CartPage() {
  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Keranjang</p>
        <h1 className="mt-2 font-display text-4xl">Keranjang</h1>
      </div>
      <div className="mt-8">
        <CartView />
      </div>
    </div>
  );
}