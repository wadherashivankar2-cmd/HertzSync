import Database from "better-sqlite3";
import { generateUlid } from "../lib/ids";
import { getCounter } from "../lib/counters";
import { computeEventsHash } from "./batcher";
import { logger } from "../lib/logger";

export interface ReconciliationRecord {
  id: string;
  runAt: number;
  generated: number;
  queued: number;
  batched: number;
  paid: number;
  flagged: number;
  accounted: number;
  lost: number;
  onchainDuplicates: number;
  ok: boolean;
}

/**
 * Runs reconciliation per Blueprint Section 5.5.
 * 1. Counts events by state: accounted = queued + batched + paid + flagged.
 * 2. lost = counters.generated_by_ingest - accounted.
 * 3. onchain_duplicates check: recompute events_hash from event IDs, confirm no event in 2 confirmed batches.
 * 4. Inserts row into reconciliations table; ok = 1 if lost === 0 && onchainDuplicates === 0.
 * 5. Prunes rate_windows older than 10 minutes.
 * 6. Runs db.pragma('wal_checkpoint(PASSIVE)').
 */
export function runReconciliation(db: Database.Database): ReconciliationRecord {
  const now = Date.now();
  const reconcileId = generateUlid(now);

  // 1. Counters and event states
  const generated = getCounter(db, "generated_by_ingest");

  const stateRows = db.prepare(`
    SELECT state, COUNT(*) as count
    FROM events
    GROUP BY state
  `).all() as { state: string; count: number }[];

  const stateCounts: Record<string, number> = {
    queued: 0,
    batched: 0,
    paid: 0,
    flagged: 0,
  };

  for (const r of stateRows) {
    if (r.state in stateCounts) {
      stateCounts[r.state] = r.count;
    }
  }

  const queued = stateCounts.queued;
  const batched = stateCounts.batched;
  const paid = stateCounts.paid;
  const flagged = stateCounts.flagged;

  const accounted = queued + batched + paid + flagged;
  const lost = generated - accounted;

  // 2. Check onchain duplicates across confirmed batches
  let onchainDuplicates = 0;

  // Confirm no event ID appears in two confirmed batches
  const duplicateEvents = db.prepare(`
    SELECT e.id, COUNT(DISTINCT e.batch_id) as batch_count
    FROM events e
    JOIN batches b ON e.batch_id = b.id
    WHERE b.state = 'confirmed'
    GROUP BY e.id
    HAVING batch_count > 1
  `).all() as { id: string; batch_count: number }[];

  onchainDuplicates += duplicateEvents.length;

  // Confirm events_hash matches stored batch
  const confirmedBatches = db.prepare(`
    SELECT id, events_hash
    FROM batches
    WHERE state = 'confirmed'
  `).all() as { id: string; events_hash: string }[];

  for (const b of confirmedBatches) {
    const eventIds = (
      db.prepare(`
        SELECT id
        FROM events
        WHERE batch_id = ?
      `).all(b.id) as { id: string }[]
    ).map((e) => e.id);

    const recomputedHash = computeEventsHash(eventIds);
    if (recomputedHash !== b.events_hash) {
      onchainDuplicates++;
      logger.error(`Reconciliation mismatch on batch ${b.id}: stored hash ${b.events_hash} != recomputed ${recomputedHash}`);
    }
  }

  const ok = lost === 0 && onchainDuplicates === 0;

  // 3. Write row to reconciliations
  db.prepare(`
    INSERT INTO reconciliations (
      id, run_at, generated, queued, batched, paid, flagged, lost, onchain_duplicates, ok
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    reconcileId,
    now,
    generated,
    queued,
    batched,
    paid,
    flagged,
    lost,
    onchainDuplicates,
    ok ? 1 : 0
  );

  // 4. Prune rate_windows older than 10 minutes (Section 5.8)
  const pruneThreshold = now - 10 * 60 * 1000;
  db.prepare(`
    DELETE FROM rate_windows
    WHERE window_start < ?
  `).run(pruneThreshold);

  // 5. Run passive checkpoint (never TRUNCATE during active loop)
  try {
    db.pragma("wal_checkpoint(PASSIVE)");
  } catch (err: any) {
    logger.warn(`Passive WAL checkpoint failed during reconciliation: ${err.message}`);
  }

  logger.info(
    `Reconciliation completed: generated=${generated}, accounted=${accounted}, lost=${lost}, duplicates=${onchainDuplicates}, ok=${ok}`
  );

  return {
    id: reconcileId,
    runAt: now,
    generated,
    queued,
    batched,
    paid,
    flagged,
    accounted,
    lost,
    onchainDuplicates,
    ok,
  };
}
