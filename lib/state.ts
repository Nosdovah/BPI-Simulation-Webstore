import type { Mode } from "./types";

/**
 * State simulasi per proses.
 *
 * Menyimpan jumlah unit komponen yang "terjual" selama sesi demo, sehingga
 * stok bundle bisa turun di mode to-be sementara kuota statis di baseline
 * tidak bergerak. In-memory (bukan database) supaya repo ini bisa jalan tanpa
 * credential apa pun; reset lewat panel /admin/simulasi.
 */

type SimState = {
  soldByMaterial: Map<string, number>;
  startedAt: number;
  telemetry: Array<Record<string, unknown>>;
};

const globalRef = globalThis as unknown as { __osrState?: SimState };

function state(): SimState {
  if (!globalRef.__osrState) {
    globalRef.__osrState = {
      soldByMaterial: new Map(),
      startedAt: Date.now(),
      telemetry: [],
    };
  }
  return globalRef.__osrState;
}

export function getSold(materialCode: string): number {
  return state().soldByMaterial.get(materialCode) ?? 0;
}

export function addSold(materialCode: string, qty: number) {
  const s = state();
  s.soldByMaterial.set(materialCode, getSold(materialCode) + qty);
}

export function resetSold() {
  state().soldByMaterial.clear();
}

export function soldSnapshot(): Record<string, number> {
  return Object.fromEntries(state().soldByMaterial.entries());
}

export function sessionStartedAt(): number {
  return state().startedAt;
}

export function pushTelemetry(entry: Record<string, unknown>) {
  const s = state();
  s.telemetry.unshift({ ...entry, at: Date.now() });
  if (s.telemetry.length > 200) s.telemetry.length = 200;
}

export function readTelemetry() {
  return state().telemetry;
}

export function parseMode(raw: string | undefined | null): Mode {
  return raw === "baseline" ? "baseline" : "tobe";
}

export const MODE_COOKIE = "osr_mode";