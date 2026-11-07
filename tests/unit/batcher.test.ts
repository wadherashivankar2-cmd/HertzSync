import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { createBatches, computeEventsHash } from "../../src/worker/batcher";
import { sha256Hex } from "../../src/lib/crypto";

describe("Worker Batcher (Blueprint Section 5.2)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let seqCounter = 0;

  beforeEach(() => {
    seqCounter = 0;
    db = createDatabaseConnection(":memory:");
    migrate(db);

    // Setup base fixtures
    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_01', 'Test Biz', 'hash_01', 1000)
    `).run();

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES
        ('payee_01', 'biz_01', 'Site 1', 'Payee11111111111111111111111111111111111111', 1000),
        ('payee_02', 'biz_01', 'Site 2', 'Payee22222222222222222222222222222222222222', 1000)
    `).run();

    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES
        ('dev_01', 'biz_01', 'payee_01', 'pub_01', 'active', 1000),
        ('dev_02', 'biz_01', 'payee_02', 'pub_02', 'active', 1000)
    `).run();
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  });

  function insertEvent(id: string, deviceId: string, amount: number, occurredAt: number, receivedAt: number) {
    seqCounter++;
    db.prepare(`
      INSERT INTO events (id, business_id, device_id, epoch, seq, amount_lamports, occurred_at, received_at, payload_hash, signature, state)
      VALUES (?, 'biz_01', ?, 1, ?, ?, ?, ?, 'hash', 'sig', 'queued')
    `).run(id, deviceId, seqCounter, amount, occurredAt, receivedAt);
  }

  it("hash determinism: events_hash is sha256 of sorted IDs joined by newline", () => {
    const ids1 = ["ev_gamma", "ev_alpha", "ev_beta"];
    const ids2 = ["ev_beta", "ev_gamma", "ev_alpha"];

    const hash1 = computeEventsHash(ids1);
    const hash2 = computeEventsHash(ids2);

    expect(hash1).toBe(hash2);
    expect(hash1).toBe(sha256Hex("ev_alpha\nev_beta\nev_gamma"));
  });

  it("grouping by payee: creates separate batches for different payees", () => {
    insertEvent("ev_01", "dev_01", 10000, 100, 100);
    insertEvent("ev_02", "dev_01", 15000, 101, 101);
    insertEvent("ev_03", "dev_02", 20000, 102, 102);

    const batches = createBatches(db);

    expect(batches).toHaveLength(2);

    const batch1 = batches.find((b) => b.payeeId === "payee_01");
    const batch2 = batches.find((b) => b.payeeId === "payee_02");

    expect(batch1).toBeDefined();
    expect(batch1!.totalLamports).toBe(25000);
    expect(batch1!.eventCount).toBe(2);
    expect(batch1!.state).toBe("built");

    expect(batch2).toBeDefined();
    expect(batch2!.totalLamports).toBe(20000);
    expect(batch2!.eventCount).toBe(1);
    expect(batch2!.state).toBe("built");

    // Events must be marked 'batched' in DB
    const evRows = db.prepare("SELECT id, state, batch_id FROM events").all() as any[];
    for (const row of evRows) {
      expect(row.state).toBe("batched");
      expect(row.batch_id).toBeDefined();
    }
  });

  it("oldest first: selects queued events in ascending order of arrival", () => {
    insertEvent("ev_third", "dev_01", 10000, 300, 300);
    insertEvent("ev_first", "dev_01", 10000, 100, 100);
    insertEvent("ev_second", "dev_01", 10000, 200, 200);

    const batches = createBatches(db, { BATCH_MAX_EVENTS: 2 });

    expect(batches).toHaveLength(2);
    expect(batches[0].eventCount).toBe(2);
    expect(batches[1].eventCount).toBe(1);

    const batch1Events = db
      .prepare("SELECT id FROM events WHERE batch_id = ? ORDER BY received_at ASC")
      .all(batches[0].id) as { id: string }[];
    expect(batch1Events.map((e) => e.id)).toEqual(["ev_first", "ev_second"]);

    const batch2Events = db
      .prepare("SELECT id FROM events WHERE batch_id = ?")
      .all(batches[1].id) as { id: string }[];
    expect(batch2Events.map((e) => e.id)).toEqual(["ev_third"]);
  });

  it("split at max: splits batch when MAX_BATCH_LAMPORTS is reached", () => {
    // Max batch lamports configured to 50,000
    insertEvent("ev_01", "dev_01", 30000, 100, 100);
    insertEvent("ev_02", "dev_01", 30000, 101, 101);
    insertEvent("ev_03", "dev_01", 15000, 102, 102);

    const batches = createBatches(db, { MAX_BATCH_LAMPORTS: 50000 });

    expect(batches).toHaveLength(2);
    expect(batches[0].totalLamports).toBe(30000);
    expect(batches[0].eventCount).toBe(1);

    expect(batches[1].totalLamports).toBe(45000);
    expect(batches[1].eventCount).toBe(2);
  });
});
