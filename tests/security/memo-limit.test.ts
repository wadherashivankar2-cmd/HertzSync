import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { RpcRouter } from "../../src/lib/rpc-router";
import { submitBatch } from "../../src/worker/settle";
import { buildBatchMemo, MEMO_MAX_BYTES } from "../../src/lib/ids";

describe("Memo Length Limit and Validation (Blueprint Section 5.3, 7.1, & S18)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let router: RpcRouter;
  const mockKeypair = Keypair.generate();
  const mockPayeeKeypair = Keypair.generate();

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    migrate(db);

    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_01', 'Test Biz', 'hash_01', 1000)
    `).run();

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_01', 'biz_01', 'Payee Site 1', '${mockPayeeKeypair.publicKey.toBase58()}', 1000)
    `).run();

    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES ('dev_01', 'biz_01', 'payee_01', 'pub_01', 'active', 1000)
    `).run();

    router = new RpcRouter(db, ["https://ep1.devnet.solana.com"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (db) {
      try {
        db.close();
      } catch {}
    }
  });

  it("buildBatchMemo rejects memos exceeding MEMO_MAX_BYTES (120 bytes)", () => {
    // Normal memo: "trickle:v1:<26-char ULID>:<64-char sha256>"
    // Length is 11 + 26 + 1 + 64 = 102 bytes <= 120 bytes
    const normalMemo = buildBatchMemo("01AN4Z07BY79KA1307SR9X4MV3", "a".repeat(64));
    expect(Buffer.byteLength(normalMemo, "utf8")).toBe(102);

    // Oversized memo: string exceeding 120 bytes
    const oversizedHash = "a".repeat(100);
    expect(() => {
      buildBatchMemo("01AN4Z07BY79KA1307SR9X4MV3", oversizedHash);
    }).toThrow(/exceeds maximum allowed bytes of 120/);
  });

  it("submitBatch refuses to sign when memo exceeds 120 bytes, marks failed_review, flags events, and logs audit", async () => {
    // Insert event
    db.prepare(`
      INSERT INTO events (
        id, business_id, device_id, epoch, seq, amount_lamports,
        occurred_at, received_at, payload_hash, signature, state, batch_id
      ) VALUES (
        'ev_memo_01', 'biz_01', 'dev_01', 1, 1, 10000,
        1000, 1000, 'hash', 'sig', 'batched', 'batch_oversized_01'
      )
    `).run();

    // Insert batch with artificially oversized events_hash
    const oversizedHash = "x".repeat(100); // 11 + 26 + 1 + 100 = 138 bytes > 120 bytes
    db.prepare(`
      INSERT INTO batches (
        id, payee_id, total_lamports, event_count, events_hash, state,
        attempts, created_at, updated_at
      ) VALUES (
        'batch_oversized_01', 'payee_01', 10000, 1, ?, 'built',
        0, 1000, 1000
      )
    `).run(oversizedHash);

    router.callWithFailover = async (op) => {
      return op({
        getBalance: async () => 500_000_000, // plenty of funds
      } as any, "https://ep1.devnet.solana.com");
    };

    const res = await submitBatch(db, router, "batch_oversized_01", mockKeypair);

    // 1. Return status must be failed_review
    expect(res.status).toBe("failed_review");

    // 2. Batch state in SQLite must be 'failed_review'
    const batch = db.prepare("SELECT * FROM batches WHERE id = 'batch_oversized_01'").get() as any;
    expect(batch.state).toBe("failed_review");
    expect(batch.signature).toBeNull();
    expect(batch.serialized_tx).toBeNull();

    // 3. Event state in SQLite must be 'flagged'
    const event = db.prepare("SELECT * FROM events WHERE id = 'ev_memo_01'").get() as any;
    expect(event.state).toBe("flagged");

    // 4. Audit log entry recorded
    const audit = db.prepare(`
      SELECT * FROM audit_log
      WHERE action = 'batch_failed_review'
      ORDER BY at DESC
      LIMIT 1
    `).get() as any;

    expect(audit).toBeDefined();
    expect(audit.actor).toBe("worker");
    const details = JSON.parse(audit.detail);
    expect(details.batchId).toBe("batch_oversized_01");
    expect(details.reason).toContain("exceeds maximum allowed bytes of 120");
  });
});
