import Link from "next/link";

export function Pagination({
  page,
  totalPages,
  basePath,
  query,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  query: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v) params.set(k, v);
    }
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `${basePath}${qs ? `?${qs}` : ""}`;
  };

  const windowStart = Math.max(1, Math.min(page - 2, totalPages - 4));
  const windowEnd = Math.min(totalPages, windowStart + 4);
  const pages: number[] = [];
  for (let p = windowStart; p <= windowEnd; p++) pages.push(p);

  return (
    <nav className="mt-14 flex items-center justify-center gap-1 text-[11px]">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className="border border-ink/20 px-3 py-2 hover:border-ink">
          ← Sebelumnya
        </Link>
      ) : (
        <span className="border border-ink/10 px-3 py-2 text-smoke/40">← Sebelumnya</span>
      )}

      {windowStart > 1 ? (
        <>
          <Link href={buildHref(1)} className="px-3 py-2 text-smoke hover:text-ink">1</Link>
          <span className="px-1 text-smoke">…</span>
        </>
      ) : null}

      {pages.map((p) => (
        <Link
          key={p}
          href={buildHref(p)}
          className={`px-3 py-2 ${
            p === page ? "bg-ink text-white" : "text-smoke hover:text-ink"
          }`}
        >
          {p}
        </Link>
      ))}

      {windowEnd < totalPages ? (
        <>
          <span className="px-1 text-smoke">…</span>
          <Link href={buildHref(totalPages)} className="px-3 py-2 text-smoke hover:text-ink">
            {totalPages}
          </Link>
        </>
      ) : null}

      {page < totalPages ? (
        <Link href={buildHref(page + 1)} className="border border-ink/20 px-3 py-2 hover:border-ink">
          Berikutnya →
        </Link>
      ) : (
        <span className="border border-ink/10 px-3 py-2 text-smoke/40">Berikutnya →</span>
      )}
    </nav>
  );
}