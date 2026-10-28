import { formatNumber } from "@/lib/format";

export function StockBadge({
  value,
  label,
  error,
  aware,
}: {
  value: number | null;
  label: string | null;
  error: string | null;
  aware: boolean;
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
          : aware
            ? "border-emerald-700/30 bg-emerald-700/5 text-emerald-800"
            : "border-ink/20 text-smoke"
      }`}
      title={aware ? "Dihitung dari stok komponen pembatas" : "Stok tersedia dari sistem inventori"}
    >
      {soldOut ? "Habis" : `Stok ${formatNumber(value)}`}
      {label ? <span className="ml-1 text-ink/40">· {label}</span> : null}
    </span>
  );
}