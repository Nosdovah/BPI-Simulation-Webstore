import Link from "next/link";
import type { Gender } from "@/lib/types";

const OPTIONS: Array<{ key: Gender | "ALL"; label: string }> = [
  { key: "ALL", label: "Semua" },
  { key: "MEN", label: "Men" },
  { key: "UNISEX", label: "Unisex" },
  { key: "WOMEN", label: "Women" },
];

export function GenderFilter({
  active,
  basePath,
  extraQuery = {},
}: {
  active: Gender | "ALL";
  basePath: string;
  extraQuery?: Record<string, string | undefined>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {OPTIONS.map((opt) => {
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