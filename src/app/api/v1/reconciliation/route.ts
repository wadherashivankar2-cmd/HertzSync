import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const db = getDb();

    const row = db.prepare(`
      SELECT 
        id,
        run_at as runAt,
        generated,
        queued,
        batched,
        paid,
        flagged,
        lost,
        onchain_duplicates as onchainDuplicates,
        ok
      FROM reconciliations
      ORDER BY run_at DESC
      LIMIT 1
    `).get() as any;

    if (!row) {
      // Calculate current baseline from tables
      const eventCounts = db.prepare(`
        SELECT 
          SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END) as queued,
          SUM(CASE WHEN state = 'batched' THEN 1 ELSE 0 END) as batched,
          SUM(CASE WHEN state = 'paid' THEN 1 ELSE 0 END) as paid,
          SUM(CASE WHEN state = 'flagged' THEN 1 ELSE 0 END) as flagged,
          COUNT(*) as total
        FROM events
      `).get() as any;

      return NextResponse.json({
        reconciliation: {
          id: null,
          runAt: Date.now(),
          generated: eventCounts?.total || 0,
          queued: eventCounts?.queued || 0,
          batched: eventCounts?.batched || 0,
          paid: eventCounts?.paid || 0,
          flagged: eventCounts?.flagged || 0,
          lost: 0,
          onchainDuplicates: 0,
          ok: 1,
        },
      });
    }

    return NextResponse.json({
      reconciliation: {
        id: row.id,
        runAt: row.runAt,
        generated: row.generated,
        queued: row.queued,
        batched: row.batched,
        paid: row.paid,
        flagged: row.flagged,
        lost: row.lost,
        onchainDuplicates: row.onchainDuplicates,
        ok: row.ok,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "internal_error", message: err.message || "Failed to fetch reconciliation." } },
      { status: 500 }
    );
  }
}
