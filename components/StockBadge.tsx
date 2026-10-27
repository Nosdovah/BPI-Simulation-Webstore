import type { Mode } from "@/lib/types";
import { formatNumber } from "@/lib/format";

export function StockBadge({
  value,
  label,
  error,
  aware,
  mode,
}: {
  value: number | null;
  label: string | null;
  error: string | null;
  aware: boolean;
  mode: Mode;
}) {
  if (error) {
    return (
      <span className="stock-pill border-alert/40 bg-alert/5 text-alert">
        ⚠ {error}
      </span>
    );
  }

  if (value === null) {
    return (
      <span className="stock-pill border-ink/20 text-smoke">Stok tidak diketahui</span>
    );
  }

  const soldOut = value <= 0;

  return (
    <span
      className={`stock-pill ${
        soldOut
          ? "border-alert/40 bg-alert/5 text-alert"
          : mode === "tobe" && aware
            ? "border-emerald-700/30 bg-emerald-700/5 text-emerald-800"
            : "border-ink/20 text-smoke"
      }`}
      title={
        mode === "baseline"
          ? "Kuota manual dari WMS 4.1 — tidak dihitung ulang dari komposisi"
          : aware
            ? "Dihitung dari stok komponen pembatas"
            : "Stok satuan dari WMS 4.1"
      }
    >
      {soldOut ? "Habis" : `Stok ${formatNumber(value)}`}
      {label ? <span className="ml-1 text-ink/40">· {label}</span> : null}
    </span>
  );
}