import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { collectMetrics } from "../../src/lib/metrics";
import { incrementCounter, setCounter } from "../../src/lib/counters";
import { setSystemState } from "../../src/lib/system-state";

describe("Metrics Endpoint Integration (Blueprint Section 8.1 & Phase 7)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    migrate(db);

    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_test_m', 'Metrics Test Biz', 'hash_test_m', 1000)
    `).run();

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_test_m', 'biz_test_m', 'Test Payee', '25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr', 1000)
    `).run();

    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES ('dev_test_m', 'biz_test_m', 'payee_test_m', 'pub_m', 'active', 1000)
    `).run();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it("returns every Section 8.1 metric key with accurate types", () => {
    const report = collectMetrics(db, {
      RPC_ENDPOINTS: "https://api.devnet.solana.com,https://devnet.helius-rpc.com",
    });

    const m = report.metrics;
    expect(m).toHaveProperty("events_received_total");
    expect(m).toHaveProperty("events_duplicate_total");
    expect(m).toHaveProperty("events_conflict_total");
    expect(m).toHaveProperty("events_rejected_total");
    expect(m).toHaveProperty("generated_by_ingest");
    expect(m).toHaveProperty("events_queued");
    expect(m).toHaveProperty("events_batched");
    expect(m).toHaveProperty("events_paid");
    expect(m).toHaveProperty("events_flagged");
    expect(m).toHaveProperty("events_lost");
    expect(m).toHaveProperty("onchain_duplicates");
    expect(m).toHaveProperty("batches_confirmed_total");
    expect(m).toHaveProperty("batch_retries_total");
    expect(m).toHaveProperty("batches_expired_rebuilt_total");
    expect(m).toHaveProperty("recovery_seconds_last");
    expect(m).toHaveProperty("confirmation_p50_ms");
    expect(m).toHaveProperty("confirmation_p95_ms");
    expect(m).toHaveProperty("ingest_p95_ms");
    expect(m).toHaveProperty("wal_size_bytes");
    expect(m).toHaveProperty("fees_paid_lamports");

    expect(typeof m.events_received_total).toBe("number");
    expect(typeof m.events_queued).toBe("number");
    expect(typeof m.events_paid).toBe("number");
    expect(typeof m.events_lost).toBe("number");
    expect(typeof m.confirmation_p50_ms).toBe("number");
    expect(typeof m.ingest_p95_ms).toBe("number");

    expect(Array.isArray(report.rpc_endpoints)).toBe(true);
    expect(report.rpc_endpoints.length).toBe(2);
    expect(report.rpc_endpoints[0]).toHaveProperty("url");
    expect(report.rpc_endpoints[0]).toHaveProperty("state");
    expect(report.rpc_endpoints[0]).toHaveProperty("failures");
    expect(report.rpc_endpoints[0]).toHaveProperty("chaosMode");
  });

  it("changing inputs dynamically changes outputs without hardcoded values", () => {
    // Initial state: empty
    const initialReport = collectMetrics(db, {
      RPC_ENDPOINTS: "https://api.devnet.solana.com",
    });
    expect(initialReport.metrics.events_received_total).toBe(0);
    expect(initialReport.metrics.events_queued).toBe(0);
    expect(initialReport.metrics.events_duplicate_total).toBe(0);
    expect(initialReport.rpc_endpoints[0].state).toBe("closed");

    // 1. Modify counters
    incrementCounter(db, "events_duplicate_total", 7);
    incrementCounter(db, "events_conflict_total", 3);
    setCounter(db, "recovery_seconds_last", 22);

    // 2. Insert queued event
    db.prepare(`
      INSERT INTO events (id, business_id, device_id, epoch, seq, amount_lamports, occurred_at, received_at, payload_hash, signature, state)
      VALUES ('e_live_1', 'biz_test_m', 'dev_test_m', 1, 1, 50000, 1000, 1000, 'h1', 's1', 'queued')
    `).run();

    // 3. Alter chaos / breaker state
    setSystemState(db, "chaos:https://api.devnet.solana.com", { mode: "down" });

    // 4. Record reconciliation row
    db.prepare(`
      INSERT INTO reconciliations (id, run_at, generated, queued, batched, paid, flagged, lost, onchain_duplicates, ok)
      VALUES ('recon_dynamic_01', 2000, 1, 1, 0, 0, 0, 0, 0, 1)
    `).run();

    // 5. Insert latency samples
    db.prepare("INSERT INTO latency_samples (at, kind, ms) VALUES (1000, 'ingest', 42)").run();
    db.prepare("INSERT INTO latency_samples (at, kind, ms) VALUES (1000, 'confirmation', 1500)").run();

    const updatedReport = collectMetrics(db, {
      RPC_ENDPOINTS: "https://api.devnet.solana.com",
    });

    // Verify all dynamic updates reflected immediately from SQLite
    expect(updatedReport.metrics.events_received_total).toBe(1);
    expect(updatedReport.metrics.events_queued).toBe(1);
    expect(updatedReport.metrics.events_duplicate_total).toBe(7);
    expect(updatedReport.metrics.events_conflict_total).toBe(3);
    expect(updatedReport.metrics.recovery_seconds_last).toBe(22);
    expect(updatedReport.metrics.ingest_p95_ms).toBe(42);
    expect(updatedReport.metrics.confirmation_p50_ms).toBe(1500);
    expect(updatedReport.rpc_endpoints[0].state).toBe("down");
    expect(updatedReport.rpc_endpoints[0].chaosMode).toBe("down");
    expect(updatedReport.reconciliation?.id).toBe("recon_dynamic_01");
  });
});

