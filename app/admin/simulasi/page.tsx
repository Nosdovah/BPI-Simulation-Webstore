import Link from "next/link";
import { cookies } from "next/headers";
import { catalogStats, componentStocks, getProductDetail } from "@/lib/core";
import { MODE_COOKIE, parseMode, readTelemetry, soldSnapshot } from "@/lib/state";
import { formatNumber, formatDateTime } from "@/lib/format";
import { SimControls } from "@/components/SimControls";

export const dynamic = "force-dynamic";

const FMEA = [
  { id: "F1", mode: "Jalur B", title: "Webhook payload kosong", effect: "Status order tidak pernah naik", rpn: 720, status: "baseline: aktif / to-be: kontrak payload + validasi" },
  { id: "F2", mode: "Jalur B", title: "Tidak ada sinkronisasi 3PL", effect: "Resi dan status kurir tidak masuk", rpn: 630, status: "baseline: aktif / to-be: poller + backoff" },
  { id: "F3", mode: "Jalur A", title: "Kuota bundle statis", effect: "Overselling sampai ±995 unit", rpn: 810, status: "baseline: aktif / to-be: MIN(FLOOR(stok/qty))" },
  { id: "F4", mode: "Jalur B", title: "Klik manual staf", effect: "Status tidak konsisten, audit trail hilang", rpn: 560, status: "baseline: aktif / to-be: actor_last SYSTEM" },
  { id: "F5", mode: "Jalur B", title: "Event out-of-order", effect: "Status mundur (DELIVERED → PROCESSING)", rpn: 480, status: "baseline: aktif / to-be: monotonic state machine" },
  { id: "F6", mode: "Jalur B", title: "Enum tidak baku (on_process)", effect: "Timeline UI rusak, laporan tidak konsisten", rpn: 400, status: "baseline: aktif / to-be: 10 status baku" },
  { id: "F7", mode: "Jalur B", title: "Event duplikat", effect: "Order ganda / stok terpotong dua kali", rpn: 450, status: "baseline: aktif / to-be: idempotency key" },
];

export default function SimulationPanel() {
  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);
  const stats = catalogStats(mode);
  const stocks = componentStocks();
  const toggleMode = mode === "tobe" ? "baseline" : "tobe";

  const flagship = getProductDetail("SANCTUM-NOCTIS-20ML-A1", mode);
  const flagshipBaseline = getProductDetail("SANCTUM-NOCTIS-20ML-A1", "baseline");
  const flagshipTobe = getProductDetail("SANCTUM-NOCTIS-20ML-A1", "tobe");

  const telemetry = readTelemetry().slice(0, 12);
  const sold = soldSnapshot();

  return (
    <div className="py-10">
      <div className="border-b border-ink/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">Panel simulasi</p>
        <h1 className="mt-2 font-display text-4xl">Kontrol Baseline vs To-Be</h1>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-smoke">
          Panel ini bukan bagian dari toko. Isinya instrumentasi yang dipakai untuk
          membuktikan cacat proses di BAB IV: angka phantom stock, FMEA F1–F7, dan
          telemetri sesi.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="border border-ink/20 px-3 py-1.5 text-[10px] uppercase tracking-widest2">
          Mode aktif: {mode === "tobe" ? "to-be" : "baseline"}
        </span>
        <Link href={`/admin/simulasi?set=${toggleMode}`} className="btn-ghost">
          Lihat dalam mode {toggleMode === "tobe" ? "to-be" : "baseline"}
        </Link>
        <Link href="/shop" className="nav-link underline underline-offset-4">Buka katalog</Link>
      </div>

      <section id="metrik" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total SKU", value: formatNumber(stats.totalSkus) },
          { label: "Single SKU", value: formatNumber(stats.singles) },
          { label: "Bundle SKU", value: formatNumber(stats.bundles) },
          { label: "Phantom stock", value: `${formatNumber(stats.phantomUnits)} unit` },
        ].map((m) => (
          <div key={m.label} className="border border-ink/15 p-5">
            <p className="text-[10px] uppercase tracking-widest2 text-smoke">{m.label}</p>
            <p className="mt-2 font-display text-3xl">{m.value}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 border border-ink/15">
        <div className="border-b border-ink/10 bg-bone px-5 py-3">
          <p className="text-[10px] uppercase tracking-widest2 text-ink">
            Bukti SKU flagship — SANCTUM-NOCTIS-20ML-A1
          </p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-widest2 text-smoke">
              <th className="px-5 py-2 font-normal">Sumber angka</th>
              <th className="px-3 py-2 text-right font-normal">Baseline</th>
              <th className="px-3 py-2 text-right font-normal">To-be</th>
              <th className="px-5 py-2 font-normal">Catatan</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-ink/5">
              <td className="px-5 py-3">Stok tampil</td>
              <td className="px-3 py-3 text-right font-mono">
                {formatNumber(flagshipBaseline?.stockDisplay ?? 0)}
              </td>
              <td className="px-3 py-3 text-right font-mono">
                {formatNumber(flagshipTobe?.stockDisplay ?? 0)}
              </td>
              <td className="px-5 py-3 text-smoke">
                {flagship?.isBundle ? "Bundle 2 botol 20ml" : ""}
              </td>
            </tr>
            <tr className="border-t border-ink/5">
              <td className="px-5 py-3">Komposisi terkirim</td>
              <td className="px-3 py-3 text-right text-alert">tidak ada</td>
              <td className="px-3 py-3 text-right text-emerald-700">2 komponen</td>
              <td className="px-5 py-3 text-smoke">
                is_bundle + components[] hanya ada di to-be
              </td>
            </tr>
            <tr className="border-t border-ink/5">
              <td className="px-5 py-3">Kapasitas komponen</td>
              <td className="px-3 py-3 text-right font-mono">—</td>
              <td className="px-3 py-3 text-right font-mono">
                {formatNumber(
                  Math.min(
                    ...(flagshipTobe?.bundleComponents ?? []).map((c) =>
                      Math.floor(c.componentStock / c.multiplierQty),
                    ),
                  ) || 0,
                )}
              </td>
              <td className="px-5 py-3 text-smoke">diambil dari stok material M2291/M2292</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mt-6">
        <SimControls />
      </section>

      <section className="mt-6 border border-ink/15 p-5">
        <p className="text-[10px] uppercase tracking-widest2 text-smoke">
          Penjualan komponen sesi ini
        </p>
        {Object.keys(sold).length === 0 ? (
          <p className="mt-2 text-xs text-smoke">Belum ada komponen yang terjual.</p>
        ) : (
          <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            {Object.entries(sold).map(([code, qty]) => (
              <li key={code} className="flex justify-between border-b border-ink/5 pb-1">
                <span className="font-mono">{code}</span>
                <span>
                  {formatNumber(qty)} unit terjual · sisa{" "}
                  {formatNumber(stocks.get(code) ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="fmea" className="mt-10">
        <h2 className="font-display text-3xl">FMEA F1–F7</h2>
        <p className="mt-1 text-xs text-smoke">
          Tujuh mode kegagalan yang direproduksi sandbox, dipetakan 1:1 ke tabel FMEA paper.
        </p>
        <div className="mt-4 overflow-x-auto border border-ink/15">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="bg-bone text-left text-[9px] uppercase tracking-widest2 text-smoke">
                <th className="px-3 py-2 font-normal">ID</th>
                <th className="px-3 py-2 font-normal">Jalur</th>
                <th className="px-3 py-2 font-normal">Mode kegagalan</th>
                <th className="px-3 py-2 font-normal">Dampak</th>
                <th className="px-3 py-2 text-right font-normal">RPN</th>
                <th className="px-3 py-2 font-normal">Perlakuan</th>
              </tr>
            </thead>
            <tbody>
              {FMEA.map((row) => (
                <tr key={row.id} className="border-t border-ink/5">
                  <td className="px-3 py-2 font-mono">{row.id}</td>
                  <td className="px-3 py-2 text-smoke">{row.mode}</td>
                  <td className="px-3 py-2">{row.title}</td>
                  <td className="px-3 py-2 text-smoke">{row.effect}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.rpn}</td>
                  <td className="px-3 py-2 text-smoke">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-3xl">Telemetri sesi</h2>
        <p className="mt-1 text-xs text-smoke">
          Event terakhir dari storefront (checkout, validasi stok, aksi simulasi).
        </p>
        <div className="mt-4 border border-ink/15">
          {telemetry.length === 0 ? (
            <p className="p-5 text-xs text-smoke">Belum ada event.</p>
          ) : (
            <ul className="divide-y divide-ink/5 text-[11px]">
              {telemetry.map((entry, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-3 px-4 py-2">
                  <span className="font-mono text-[10px] text-smoke">
                    {String(entry.at ? formatDateTime(Number(entry.at)) : "—")}
                  </span>
                  <span className="uppercase tracking-widest2">{String(entry.event ?? "?")}</span>
                  <span className="font-mono text-[10px] text-smoke">
                    {JSON.stringify(
                      Object.fromEntries(
                        Object.entries(entry).filter(([k]) => k !== "at" && k !== "event"),
                      ),
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}