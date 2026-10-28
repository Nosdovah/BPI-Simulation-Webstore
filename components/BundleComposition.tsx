import type { BundleComponent } from "@/lib/types";
import { formatNumber } from "@/lib/format";

export function BundleComposition({
  components,
}: {
  components: BundleComponent[];
}) {
  if (components.length === 0) {
    return (
      <div className="border border-alert/40 bg-alert/5 p-4">
        <p className="text-[10px] uppercase tracking-widest2 text-alert">
          Data komposisi tidak tersedia
        </p>
        <p className="mt-2 text-xs text-smoke">
          SKU ditandai sebagai paket tetapi komponennya belum lengkap. Sesuai aturan
          katalog, pembelian paket diblokir sampai komposisinya tersedia.
        </p>
      </div>
    );
  }

  const capacities = components.map((c) => ({
    ...c,
    capacity: Math.floor(c.componentStock / c.multiplierQty),
  }));
  const bottleneck = Math.min(...capacities.map((c) => c.capacity));

  return (
    <div className="border border-ink/15">
      <div className="flex items-center justify-between border-b border-ink/10 bg-bone px-4 py-2">
        <p className="text-[10px] uppercase tracking-widest2 text-ink">
          Komposisi paket
        </p>
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">
          Stok paket = komponen pembatas
        </p>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-widest2 text-smoke">
            <th className="px-4 py-2 font-normal">Komponen</th>
            <th className="px-2 py-2 font-normal">Qty</th>
            <th className="px-2 py-2 text-right font-normal">Stok</th>
            <th className="px-4 py-2 text-right font-normal">Kapasitas</th>
          </tr>
        </thead>
        <tbody>
          {capacities.map((c) => {
            const isBottleneck = c.capacity === bottleneck;
            return (
              <tr key={c.materialCode} className="border-t border-ink/5">
                <td className="px-4 py-2">
                  <span className="block text-ink">{c.name}</span>
                  <span className="font-mono text-[10px] text-smoke">
                    {c.materialCode}
                  </span>
                </td>
                <td className="px-2 py-2 text-smoke">{c.multiplierQty}×</td>
                <td className="px-2 py-2 text-right">{formatNumber(c.componentStock)}</td>
                <td
                  className={`px-4 py-2 text-right ${
                    isBottleneck ? "font-semibold text-alert" : "text-smoke"
                  }`}
                >
                  {formatNumber(c.capacity)}
                  {isBottleneck ? " ←" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-ink/10 px-4 py-2 text-[10px] text-smoke">
        Kapasitas dihitung <code className="font-mono">MIN(FLOOR(stok / qty))</code> dari
        seluruh komponen, lalu ditampilkan sebagai stok paket.
      </p>
    </div>
  );
}