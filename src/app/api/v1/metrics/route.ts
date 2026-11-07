import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { collectMetrics } from "@/lib/metrics";

export async function GET() {
  try {
    const db = getDb();
    const config = getConfig();
    const result = collectMetrics(db, config);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "internal_error", message: err.message || "Failed to load metrics." } },
      { status: 500 }
    );
  }
}
