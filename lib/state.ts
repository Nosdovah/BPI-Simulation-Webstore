/**
 * State sesi per proses.
 *
 * Menyimpan jumlah unit komponen yang sudah terjual selama server hidup,
 * sehingga stok paket ikut turun setiap komponen terjual. In-memory (bukan
 * database) supaya repo ini bisa jalan tanpa credential apa pun.
 */

type SessionState = {
  soldByMaterial: Map<string, number>;
  startedAt: number;
  telemetry: Array<Record<string, unknown>>;
};

const globalRef = globalThis as unknown as { __osrState?: SessionState };

function state(): SessionState {
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