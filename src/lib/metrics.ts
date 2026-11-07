import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getConfig, Config } from "./config";
import { getAllCounters, getCounter } from "./counters";
import { getSystemState } from "./system-state";

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  count: number;
}

export interface EndpointMetricState {
  url: string;
  state: string; // "closed" | "open" | "half_open" | "down"
  failures: number;
  chaosMode: string;
}

export interface SystemMetricsReport {
  metrics: {
    events_received_total: number;
    events_duplicate_total: number;
    events_conflict_total: number;
    events_rejected_total: number;
    generated_by_ingest: number;
    events_queued: number;
    events_batched: number;
    events_paid: number;
    events_flagged: number;
    events_lost: number;
    onchain_duplicates: number;
    batches_confirmed_total: number;
    batch_retries_total: number;
    batches_expired_rebuilt_total: number;
    recovery_seconds_last: number | null;
    confirmation_p50_ms: number;
    confirmation_p95_ms: number;
    ingest_p95_ms: number;
    wal_size_bytes: number;
    fees_paid_lamports: number;
  };
  rpc_endpoints: EndpointMetricState[];
  reconciliation: any | null;
  recent_audit_logs: any[];
  chaos_enabled: boolean;
}

/**
 * Calculates p50 and p95 percentiles over recorded latency samples for a given kind.
 * Blueprint Section 7 & 8.1.
 */
export function calculateLatencyPercentiles(
  db: Database.Database,
  kind: "ingest" | "confirmation"
): LatencyPercentiles {
  const rows = db.prepare(`
    SELECT ms FROM latency_samples
    WHERE kind = ?
    ORDER BY ms ASC
  `).all(kind) as { ms: number }[];

  const count = rows.length;
  if (count === 0) {
    return { p50: 0, p95: 0, count: 0 };
  }

  // Nearest-rank percentile calculation
  const p50Index = Math.min(count - 1, Math.floor(count * 0.5));
  const p95Index = Math.min(count - 1, Math.floor(count * 0.95));

  return {
    p50: rows[p50Index].ms,
    p95: rows[p95Index].ms,
    count,
  };
}

/**
 * Prunes latency_samples to the most recent maxPerKind samples per kind (default 10,000).
 * Blueprint Phase 7 requirement.
 */
export function pruneLatencySamples(
  db: Database.Database,
  maxPerKind: number = 10000
): { prunedIngest: number; prunedConfirmation: number } {
  let prunedIngest = 0;
  let prunedConfirmation = 0;

  for (const kind of ["ingest", "confirmation"] as const) {
    const totalRow = db.prepare(`
      SELECT COUNT(*) as total FROM latency_samples WHERE kind = ?
    `).get(kind) as { total: number };

    if (totalRow.total > maxPerKind) {
      const deleteCount = totalRow.total - maxPerKind;
      const res = db.prepare(`
        DELETE FROM latency_samples
        WHERE id IN (
          SELECT id FROM latency_samples
          WHERE kind = ?
          ORDER BY id ASC
          LIMIT ?
        )
      `).run(kind, deleteCount);

      if (kind === "ingest") prunedIngest = res.changes;
      else prunedConfirmation = res.changes;
    }
  }

  return { prunedIngest, prunedConfirmation };
}

/**
 * Collects all metrics from SQLite according to Blueprint Section 8.1.
 * Reads counters, event states, batch states, latency percentiles, breaker/chaos states,
 * WAL size, and latest reconciliation row.
 */
export function collectMetrics(
  db: Database.Database,
  configOverride?: Partial<Config>
): SystemMetricsReport {
  const config = { ...getConfig(), ...configOverride };

  // 1. Read counters
  const counters = getAllCounters(db);

  // 2. Query event states directly from events table
  const eventCounts = db.prepare(`
    SELECT 
      SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN state = 'batched' THEN 1 ELSE 0 END) as batched,
      SUM(CASE WHEN state = 'paid' THEN 1 ELSE 0 END) as paid,
      SUM(CASE WHEN state = 'flagged' THEN 1 ELSE 0 END) as flagged,
      COUNT(*) as total
    FROM events
  `).get() as {
    queued: number | null;
    batched: number | null;
    paid: number | null;
    flagged: number | null;
    total: number;
  };

  // 3. Query batch states directly from batches table
  const batchCounts = db.prepare(`
    SELECT 
      SUM(CASE WHEN state = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN state = 'retrying' THEN 1 ELSE 0 END) as retrying,
      SUM(CASE WHEN state = 'expired_rebuilt' THEN 1 ELSE 0 END) as expired_rebuilt,
      SUM(attempts) as total_attempts,
      COUNT(*) as total
    FROM batches
  `).get() as {
    confirmed: number | null;
    retrying: number | null;
    expired_rebuilt: number | null;
    total_attempts: number | null;
    total: number;
  };

  // 4. Query latest reconciliation row
  const latestReconciliation = db.prepare(`
    SELECT * FROM reconciliations ORDER BY run_at DESC LIMIT 1
  `).get() as any;

  // 5. Query latency percentiles
  const ingestLatency = calculateLatencyPercentiles(db, "ingest");
  const confirmLatency = calculateLatencyPercentiles(db, "confirmation");

  // 6. Query RPC endpoint breaker and chaos states from system_state
  const endpoints = config.RPC_ENDPOINTS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const rpcEndpointStates: EndpointMetricState[] = endpoints.map((ep) => {
    const breakerState = getSystemState<{ state?: string; failures?: number }>(
      db,
      `breaker:${ep}`
    );
    const chaosState = getSystemState<{ mode?: string }>(db, `chaos:${ep}`);

    const chaosMode = chaosState?.value?.mode || "none";
    const breakerMode = breakerState?.value?.state || "closed";
    const state = chaosMode === "down" ? "down" : breakerMode;

    return {
      url: ep,
      state,
      failures: breakerState?.value?.failures || 0,
      chaosMode,
    };
  });

  // 7. Query recovery seconds last from system_state or counters
  const recoveryLastState = getSystemState<{ recoverySeconds?: number }>(
    db,
    "recovery:last"
  );
  const recoverySecondsLast =
    recoveryLastState?.value?.recoverySeconds ??
    (counters["recovery_seconds_last"] !== undefined
      ? counters["recovery_seconds_last"]
      : null);

  // 8. WAL file size in bytes
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

  return {
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
      batch_retries_total:
        counters["batch_retries_total"] ||
        Math.max(0, (batchCounts?.total_attempts || 0) - (batchCounts?.total || 0)),
      batches_expired_rebuilt_total:
        counters["batches_expired_rebuilt_total"] ||
        batchCounts?.expired_rebuilt ||
        0,
      recovery_seconds_last: recoverySecondsLast,
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
  };
}

