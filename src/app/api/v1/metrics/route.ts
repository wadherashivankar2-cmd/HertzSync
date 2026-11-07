import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { getAllCounters } from "@/lib/counters";
import { getSystemState } from "@/lib/system-state";

export async function GET() {
  try {
    const db = getDb();
    const config = getConfig();

    // 1. Read counters
    const counters = getAllCounters(db);

    // 2. Query event states
    const eventCounts = db.prepare(`
      SELECT 
        SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN state = 'batched' THEN 1 ELSE 0 END) as batched,
        SUM(CASE WHEN state = 'paid' THEN 1 ELSE 0 END) as paid,
        SUM(CASE WHEN state = 'flagged' THEN 1 ELSE 0 END) as flagged,
        COUNT(*) as total
      FROM events
    `).get() as { queued: number | null; batched: number | null; paid: number | null; flagged: number | null; total: number };

    // 3. Query batch states
    const batchCounts = db.prepare(`
      SELECT 
        SUM(CASE WHEN state = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN state = 'retrying' THEN 1 ELSE 0 END) as retrying,
        SUM(CASE WHEN state = 'expired_rebuilt' THEN 1 ELSE 0 END) as expired_rebuilt,
        SUM(attempts) as total_attempts,
        COUNT(*) as total
      FROM batches
    `).get() as { confirmed: number | null; retrying: number | null; expired_rebuilt: number | null; total_attempts: number | null; total: number };

    // 4. Query latest reconciliation
    const latestReconciliation = db.prepare(`
      SELECT * FROM reconciliations ORDER BY run_at DESC LIMIT 1
    `).get() as any;

    // 5. Query latency samples
    function getPercentiles(kind: "ingest" | "confirmation") {
      const samples = db.prepare(`
        SELECT ms FROM latency_samples WHERE kind = ? ORDER BY ms ASC LIMIT 1000
      `).all(kind) as { ms: number }[];

      if (samples.length === 0) return { p50: 0, p95: 0, count: 0 };
      const p50 = samples[Math.floor(samples.length * 0.50)].ms;
      const p95 = samples[Math.floor(samples.length * 0.95)].ms;
      return { p50, p95, count: samples.length };
    }

    const ingestLatency = getPercentiles("ingest");
    const confirmLatency = getPercentiles("confirmation");

    // 6. Query RPC endpoint states from system_state
    const endpoints = config.RPC_ENDPOINTS.split(",").map((s) => s.trim()).filter(Boolean);
    const rpcEndpointStates = endpoints.map((ep) => {
      const breakerState = getSystemState<{ state?: string; failures?: number }>(db, `breaker:${ep}`);
      const chaosState = getSystemState<{ mode?: string }>(db, `chaos:${ep}`);

      const chaosMode = chaosState?.value?.mode || "none";
      const breakerMode = breakerState?.value?.state || "closed";
      const state = chaosMode === "down" ? "down" : breakerMode;

      return {
        url: ep,
        state, // "closed" (healthy), "open" (tripped), "half_open", or "down"
        failures: breakerState?.value?.failures || 0,
        chaosMode,
      };
    });

    // 7. Recovery seconds last
    const recoveryLast = getSystemState<{ recoverySeconds?: number }>(db, "recovery:last");

    // 8. WAL file size
    let walSizeBytes = 0;
    try {
      const walPath = `${config.DB_PATH}-wal`;
      if (fs.existsSync(walPath)) {
        walSizeBytes = fs.statSync(walPath).size;
      }
    } catch {}

    // 9. Recent audit log lines (latest 50)
    const recentAuditLogs = db.prepare(`
      SELECT id, at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT 50
    `).all() as { id: number; at: number; actor: string; action: string; detail: string }[];

    const confirmedBatches = batchCounts?.confirmed || 0;
    const feesPaidLamports = confirmedBatches * 5000;

    return NextResponse.json({
      metrics: {
        events_received_total: eventCounts.total || 0,
        events_duplicate_total: counters["events_duplicate_total"] || 0,
        events_conflict_total: counters["events_conflict_total"] || 0,
        events_rejected_total: counters["events_rejected_total"] || 0,
        generated_by_ingest: eventCounts.total || 0,
        events_queued: eventCounts.queued || 0,
        events_batched: eventCounts.batched || 0,
        events_paid: eventCounts.paid || 0,
        events_flagged: eventCounts.flagged || 0,
        events_lost: latestReconciliation?.lost ?? 0,
        onchain_duplicates: latestReconciliation?.onchain_duplicates ?? 0,
        batches_confirmed_total: confirmedBatches,
        batch_retries_total: counters["batch_retries_total"] || Math.max(0, (batchCounts?.total_attempts || 0) - (batchCounts?.total || 0)),
        batches_expired_rebuilt_total: counters["batches_expired_rebuilt_total"] || batchCounts?.expired_rebuilt || 0,
        recovery_seconds_last: recoveryLast?.value?.recoverySeconds ?? null,
        confirmation_p50_ms: confirmLatency.p50,
        confirmation_p95_ms: confirmLatency.p95,
        ingest_p95_ms: ingestLatency.p95,
        wal_size_bytes: walSizeBytes,
        fees_paid_lamports: feesPaidLamports,
      },
      rpc_endpoints: rpcEndpointStates,
      reconciliation: latestReconciliation || null,
      recent_audit_logs: recentAuditLogs.map((log) => {
        let parsedDetail = {};
        try {
          parsedDetail = JSON.parse(log.detail || "{}");
        } catch {}
        return {
          id: log.id,
          at: log.at,
          actor: log.actor,
          action: log.action,
          detail: parsedDetail,
        };
      }),
      chaos_enabled: config.CHAOS_ENABLED,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "internal_error", message: err.message || "Failed to load metrics." } },
      { status: 500 }
    );
  }
}
