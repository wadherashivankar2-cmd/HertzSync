import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));

    const rows = db.prepare(`
      SELECT 
        b.id,
        b.payee_id,
        p.label as payee_label,
        p.solana_address as payee_address,
        b.total_lamports,
        b.event_count,
        b.events_hash,
        b.state,
        b.signature,
        b.attempts,
        b.independent_check,
        b.single_endpoint_fallback,
        b.check_recorded,
        b.created_at,
        b.updated_at
      FROM batches b
      LEFT JOIN payees p ON b.payee_id = p.id
      ORDER BY b.created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return NextResponse.json({
      batches: rows.map((row) => {
        const checkRecorded = Boolean(row.check_recorded);
        const independentCheck = Boolean(row.independent_check);
        const singleEndpointFallback = Boolean(row.single_endpoint_fallback);

        let verificationStatus: "pending" | "two_endpoint" | "single_endpoint" | "legacy";
        if (row.state !== "confirmed") {
          verificationStatus = "pending";
        } else if (checkRecorded && independentCheck) {
          verificationStatus = "two_endpoint";
        } else if (checkRecorded && singleEndpointFallback) {
          verificationStatus = "single_endpoint";
        } else {
          verificationStatus = "legacy";
        }

        return {
          id: row.id,
          payeeId: row.payee_id,
          payeeLabel: row.payee_label || row.payee_id,
          payeeAddress: row.payee_address || "",
          totalLamports: row.total_lamports,
          totalSol: (row.total_lamports / 1e9).toFixed(row.total_lamports % 1e7 === 0 ? 2 : 4),
          eventCount: row.event_count,
          eventsHash: row.events_hash,
          state: row.state,
          signature: row.signature,
          explorerUrl: row.signature ? `https://explorer.solana.com/tx/${row.signature}?cluster=devnet` : null,
          attempts: row.attempts,
          independentCheck,
          singleEndpointFallback,
          checkRecorded,
          verificationStatus,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      }),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "internal_error", message: err.message || "Failed to fetch batches." } },
      { status: 500 }
    );
  }
}
