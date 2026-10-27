import { NextResponse } from "next/server";
import { addSold, pushTelemetry, resetSold } from "@/lib/state";
import { findProductByMaterial } from "@/lib/catalog";

/**
 * Aksi simulasi untuk panel admin.
 *  POST { action: "sell", materialCode, qty } — jual komponen (uji oversell)
 *  POST { action: "reset" }                     — reset penjualan sesi
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    materialCode?: string;
    qty?: number;
  };

  if (body.action === "reset") {
    resetSold();
    pushTelemetry({ event: "sim_reset" });
    return NextResponse.json({ ok: true, action: "reset" });
  }

  if (body.action === "sell") {
    const materialCode = body.materialCode?.trim();
    const qty = Math.max(1, Math.min(100000, Math.floor(Number(body.qty ?? 1))));
    if (!materialCode) {
      return NextResponse.json({ error: "MATERIAL_REQUIRED" }, { status: 400 });
    }
    const product = findProductByMaterial(materialCode);
    if (!product) {
      return NextResponse.json({ error: "MATERIAL_NOT_FOUND" }, { status: 404 });
    }
    addSold(materialCode, qty);
    pushTelemetry({ event: "sim_sell", materialCode, qty });
    return NextResponse.json({ ok: true, action: "sell", materialCode, qty });
  }

  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}