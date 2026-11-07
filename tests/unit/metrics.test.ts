import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import {
  calculateLatencyPercentiles,
  pruneLatencySamples,
  collectMetrics,
} from "../../src/lib/metrics";
import { incrementCounter, getCounter, setCounter } from "../../src/lib/counters";

describe("Metrics Unit Tests (Blueprint Phase 7)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it("increments counters and reads them accurately", () => {
    expect(getCounter(db, "events_received_total")).toBe(0);
    incrementCounter(db, "events_received_total");
    incrementCounter(db, "events_received_total");
    expect(getCounter(db, "events_received_total")).toBe(2);

    incrementCounter(db, "events_duplicate_total", 5);
    expect(getCounter(db, "events_duplicate_total")).toBe(5);

    setCounter(db, "recovery_seconds_last", 14);
    expect(getCounter(db, "recovery_seconds_last")).toBe(14);
  });

  it("calculates p50 and p95 accurately over known dataset", () => {
    // Empty dataset
    const empty = calculateLatencyPercentiles(db, "ingest");
    expect(empty).toEqual({ p50: 0, p95: 0, count: 0 });

    // Insert 100 known samples: 1ms, 2ms, ..., 100ms
    const insertStmt = db.prepare("INSERT INTO latency_samples (at, kind, ms) VALUES (?, 'ingest', ?)");
    const now = Date.now();
    for (let i = 1; i <= 100; i++) {
      insertStmt.run(now + i, i);
    }

    const res = calculateLatencyPercentiles(db, "ingest");
    expect(res.count).toBe(100);
    // 50th percentile of 1..100 with floor(100 * 0.5) = index 50 -> value 51
    expect(res.p50).toBe(51);
    // 95th percentile of 1..100 with floor(100 * 0.95) = index 95 -> value 96
    expect(res.p95).toBe(96);
  });

  it("prunes latency samples exceeding maxPerKind limit (10,000)", () => {
    const insertStmt = db.prepare("INSERT INTO latency_samples (at, kind, ms) VALUES (?, 'ingest', ?)");
    const now = Date.now();

    // Insert 15 samples with maxPerKind = 10 to test boundary
    for (let i = 1; i <= 15; i++) {
      insertStmt.run(now + i, i * 10);
    }

    const initialCount = (db.prepare("SELECT COUNT(*) as c FROM latency_samples WHERE kind = 'ingest'").get() as any).c;
    expect(initialCount).toBe(15);

    // Prune to 10
    const { prunedIngest } = pruneLatencySamples(db, 10);
    expect(prunedIngest).toBe(5);

    const remainingRows = db.prepare("SELECT ms FROM latency_samples WHERE kind = 'ingest' ORDER BY id ASC").all() as { ms: number }[];
    expect(remainingRows.length).toBe(10);
    // Verify oldest 5 (10, 20, 30, 40, 50) were pruned and newest 10 (60..150) remain
    expect(remainingRows[0].ms).toBe(60);
    expect(remainingRows[9].ms).toBe(150);
  });

  it("collectMetrics compiles complete Section 8.1 metric structure from SQLite", () => {
    // Setup business, payee, device
    db.prepare("INSERT INTO businesses (id, name, api_key_hash, created_at) VALUES ('b1', 'Biz', 'h', 100)").run();
    db.prepare("INSERT INTO payees (id, business_id, label, solana_address, created_at) VALUES ('p1', 'b1', 'P1', 'addr', 100)").run();
    db.prepare("INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at) VALUES ('d1', 'b1', 'p1', 'k', 'active', 100)").run();

    // Insert 2 queued, 3 paid events
    for (let i = 1; i <= 2; i++) {
      db.prepare("INSERT INTO events (id, business_id, device_id, epoch, seq, amount_lamports, occurred_at, received_at, payload_hash, signature, state) VALUES (?, 'b1', 'd1', 1, ?, 1000, 100, 100, 'h', 's', 'queued')").run(`e_q_${i}`, i);
    }
    for (let i = 1; i <= 3; i++) {
      db.prepare("INSERT INTO events (id, business_id, device_id, epoch, seq, amount_lamports, occurred_at, received_at, payload_hash, signature, state) VALUES (?, 'b1', 'd1', 1, ?, 1000, 100, 100, 'h', 's', 'paid')").run(`e_p_${i}`, i + 10);
    }

    // Insert reconciliation row
    db.prepare("INSERT INTO reconciliations (id, run_at, generated, queued, batched, paid, flagged, lost, onchain_duplicates, ok) VALUES ('r1', 1000, 5, 2, 0, 3, 0, 0, 0, 1)").run();

    const report = collectMetrics(db, { RPC_ENDPOINTS: "https://mock.rpc.com" });
    expect(report.metrics.events_received_total).toBe(5);
    expect(report.metrics.events_queued).toBe(2);
    expect(report.metrics.events_paid).toBe(3);
    expect(report.metrics.events_lost).toBe(0);
    expect(report.metrics.onchain_duplicates).toBe(0);
    expect(report.reconciliation?.id).toBe("r1");
    expect(report.rpc_endpoints[0].url).toBe("https://mock.rpc.com");
  });
});

