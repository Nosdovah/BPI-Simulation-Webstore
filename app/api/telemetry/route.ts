import { NextResponse } from "next/server";
import { pushTelemetry, readTelemetry } from "@/lib/state";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  pushTelemetry({ event: "client_metric", ...body });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ entries: readTelemetry() });
}