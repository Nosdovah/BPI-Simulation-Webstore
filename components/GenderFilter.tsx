import Link from "next/link";
import type { Gender } from "@/lib/types";

export type SegmentOption = { key: string; label: string; total?: number };

/**
 * Filter segmen (brand) — opsinya datang dari master data ERP lewat prop
 * `options`, bukan daftar tetap di komponen.
 */
export function GenderFilter({
  active,
  basePath,
  extraQuery = {},
  options,
  label = "Segmen",
}: {
  active: Gender | "ALL";
  basePath: string;
  extraQuery?: Record<string, string | undefined>;
  options: SegmentOption[];
  label?: string;
}) {
  const all: SegmentOption[] = [
    { key: "ALL", label: "Semua" },
    ...options,
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[9px] uppercase tracking-widest2 text-smoke">{label}</span>
      {all.map((opt) => {
        const params = new URLSearchParams();
        if (opt.key !== "ALL") params.set("gender", opt.key);
        for (const [k, v] of Object.entries(extraQuery)) {
          if (v) params.set(k, v);
        }
        const qs = params.toString();
        const activeNow = active === opt.key;
        return (
          <Link
            key={opt.key}
            href={`${basePath}${qs ? `?${qs}` : ""}`}
            className={`border px-4 py-2 text-[10px] uppercase tracking-widest2 transition-colors ${
              activeNow
                ? "border-ink bg-ink text-white"
                : "border-ink/20 text-smoke hover:border-ink hover:text-ink"
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}