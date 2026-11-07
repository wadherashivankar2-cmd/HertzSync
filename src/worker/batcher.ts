import Database from "better-sqlite3";
import { generateUlid } from "../lib/ids";
import { sha256Hex } from "../lib/crypto";
import { getConfig, Config } from "../lib/config";
import { BatchState } from "../lib/state";
import { logger } from "../lib/logger";

export interface BatchRecord {
  id: string;
  payeeId: string;
  totalLamports: number;
  eventCount: number;
  eventsHash: string;
  state: BatchState;
  signature?: string | null;
  serializedTx?: string | null;
  lastValidBlockHeight?: number | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

interface QueuedEventRow {
  id: string;
  amount_lamports: number;
  occurred_at: number;
  received_at: number;
  payee_id: string;
}

/**
 * Computes deterministic events_hash = sha256(sorted event IDs joined by "\n").
 * Section 5.2 Step 3.
 */
export function computeEventsHash(eventIds: string[]): string {
  const sorted = [...eventIds].sort();
  return sha256Hex(sorted.join("\n"));
}

/**
 * Groups queued events by payee, enforces BATCH_MAX_EVENTS and MAX_BATCH_LAMPORTS,
 * inserts built batches, and transitions events from 'queued' to 'batched' in a single transaction.
 * Blueprint Section 5.2.
 */
export function createBatches(db: Database.Database, configOverride?: Partial<Config>): BatchRecord[] {
  const config = { ...getConfig(), ...configOverride };
  const batchMaxEvents = config.BATCH_MAX_EVENTS;
  const maxBatchLamports = config.MAX_BATCH_LAMPORTS;

  // 1. Select all queued events grouped by payee, ordered oldest first
  const query = `
    SELECT e.id, e.amount_lamports, e.occurred_at, e.received_at, d.payee_id
    FROM events e
    JOIN devices d ON e.device_id = d.id
    WHERE e.state = 'queued'
    ORDER BY d.payee_id, e.received_at ASC, e.occurred_at ASC, e.id ASC
  `;

  const queuedEvents = db.prepare(query).all() as QueuedEventRow[];
  if (queuedEvents.length === 0) {
    return [];
  }

  // Group by payee_id
  const eventsByPayee = new Map<string, QueuedEventRow[]>();
  for (const ev of queuedEvents) {
    const list = eventsByPayee.get(ev.payee_id);
    if (!list) {
      eventsByPayee.set(ev.payee_id, [ev]);
    } else {
      list.push(ev);
    }
  }

  const createdBatches: BatchRecord[] = [];

  const insertBatchStmt = db.prepare(`
    INSERT INTO batches (
      id, payee_id, total_lamports, event_count, events_hash, state, attempts, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, 'built', 0, ?, ?
    )
  `);

  const updateEventStmt = db.prepare(`
    UPDATE events
    SET state = 'batched', batch_id = ?
    WHERE id = ?
  `);

  // Execute batch creation in a single SQLite transaction
  const executeBatchCreation = db.transaction(() => {
    const now = Date.now();

    for (const [payeeId, events] of eventsByPayee.entries()) {
      let currentBatchEvents: QueuedEventRow[] = [];
      let currentLamportsSum = 0;

      for (const ev of events) {
        const wouldExceedLamports =
          currentBatchEvents.length > 0 &&
          currentLamportsSum + ev.amount_lamports > maxBatchLamports;
        const wouldExceedCount = currentBatchEvents.length >= batchMaxEvents;

        if (wouldExceedLamports || wouldExceedCount) {
          // Flush current batch
          const batch = commitBatchGroup(
            payeeId,
            currentBatchEvents,
            currentLamportsSum,
            now
          );
          createdBatches.push(batch);

          // Reset for next batch
          currentBatchEvents = [ev];
          currentLamportsSum = ev.amount_lamports;
        } else {
          currentBatchEvents.push(ev);
          currentLamportsSum += ev.amount_lamports;
        }
      }

      // Flush remainder
      if (currentBatchEvents.length > 0) {
        const batch = commitBatchGroup(
          payeeId,
          currentBatchEvents,
          currentLamportsSum,
          now
        );
        createdBatches.push(batch);
      }
    }

    function commitBatchGroup(
      payeeId: string,
      batchEvents: QueuedEventRow[],
      totalLamports: number,
      timestamp: number
    ): BatchRecord {
      const batchId = generateUlid(timestamp);
      const eventIds = batchEvents.map((e) => e.id);
      const eventsHash = computeEventsHash(eventIds);

      insertBatchStmt.run(
        batchId,
        payeeId,
        totalLamports,
        batchEvents.length,
        eventsHash,
        timestamp,
        timestamp
      );

      for (const ev of batchEvents) {
        updateEventStmt.run(batchId, ev.id);
      }

      logger.info(
        `Batch ${batchId} built for payee ${payeeId}: ${batchEvents.length} events, ${totalLamports} lamports.`
      );

      return {
        id: batchId,
        payeeId,
        totalLamports,
        eventCount: batchEvents.length,
        eventsHash,
        state: "built",
        signature: null,
        serializedTx: null,
        lastValidBlockHeight: null,
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }
  });

  executeBatchCreation();
  return createdBatches;
}
