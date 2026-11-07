import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { RpcRouter } from "../../src/lib/rpc-router";
import * as settleModule from "../../src/worker/settle";
import { retryBatch } from "../../src/worker/settle";
import { getCounter } from "../../src/lib/counters";

describe("Retry Policy (Blueprint Section 5.4)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let mockRouter: RpcRouter;
  const mockKeypair = Keypair.generate();

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    migrate(db);

    // Setup base fixtures
    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_01', 'Test Biz', 'hash_01', 1000)
    `).run();

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_01', 'biz_01', 'Site 1', '${mockKeypair.publicKey.toBase58()}', 1000)
    `).run();

    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES ('dev_01', 'biz_01', 'payee_01', 'pub_01', 'active', 1000)
    `).run();

    db.prepare(`
      INSERT INTO events (id, business_id, device_id, epoch, seq, amount_lamports, occurred_at, received_at, payload_hash, signature, state, batch_id)
      VALUES ('ev_01', 'biz_01', 'dev_01', 1, 1, 10000, 1000, 1000, 'hash', 'sig', 'batched', 'batch_01')
    `).run();

    mockRouter = new RpcRouter(db, ["https://ep1.devnet.solana.com", "https://ep2.devnet.solana.com"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (db) {
      try {
        db.close();
      } catch {}
    }
  });

  function setupBatch(attempts: number, lastValidBlockHeight: number) {
    db.prepare(`
      INSERT INTO batches (
        id, payee_id, total_lamports, event_count, events_hash, state,
        signature, serialized_tx, last_valid_block_height, attempts, created_at, updated_at
      ) VALUES (
        'batch_01', 'payee_01', 10000, 1, 'mock_events_hash', 'submitted',
        'mock_sig_12345', 'mock_serialized_tx_base64', ?, ?, 1000, 1000
      )
    `).run(lastValidBlockHeight, attempts);
  }

  it("branch 1: confirmed elsewhere -> marks confirmed and does not resend", async () => {
    setupBatch(1, 200);

    mockRouter.callWithFailover = async (op) => {
      return op({
        getSignatureStatuses: async () => ({
          value: [{ confirmationStatus: "confirmed", err: null }],
        }),
      } as any, "https://ep1.devnet.solana.com");
    };

    const res = await retryBatch(db, mockRouter, "batch_01", mockKeypair);

    expect(res.status).toBe("confirmed");

    const batch = db.prepare("SELECT state FROM batches WHERE id = 'batch_01'").get() as any;
    expect(batch.state).toBe("confirmed");

    const event = db.prepare("SELECT state FROM events WHERE id = 'ev_01'").get() as any;
    expect(event.state).toBe("paid");
  });

  it("branch 2: not found before expiry (height <= last_valid) -> resends identical serialized_tx", async () => {
    setupBatch(1, 200); // lastValid = 200

    vi.spyOn(settleModule, "crossCheckSignatureStatus").mockResolvedValue({
      confirmed: false,
      lied: false,
    });

    let sentRawTxBase64: string | null = null;

    mockRouter.callWithFailover = async (op) => {
      return op({
        getBlockHeight: async () => 150, // 150 <= 200 (not expired)
        sendRawTransaction: async (raw: Buffer) => {
          sentRawTxBase64 = raw.toString("base64");
          return "mock_sig_12345";
        },
      } as any, "https://ep1.devnet.solana.com");
    };

    const res = await retryBatch(db, mockRouter, "batch_01", mockKeypair);

    expect(res.status).toBe("retrying");
    // Verifies the exact same buffer was resent
    expect(Buffer.from(sentRawTxBase64!, "base64").toString("utf8")).toBe(
      Buffer.from("mock_serialized_tx_base64", "base64").toString("utf8")
    );

    const batch = db.prepare("SELECT state, attempts FROM batches WHERE id = 'batch_01'").get() as any;
    expect(batch.state).toBe("retrying");
    expect(batch.attempts).toBe(2);
  });

  it("branch 3: not found after expiry (height > last_valid) -> rebuilds with fresh blockhash", async () => {
    setupBatch(1, 200); // lastValid = 200

    vi.spyOn(settleModule, "crossCheckSignatureStatus").mockResolvedValue({
      confirmed: false,
      lied: false,
    });

    // Valid base58 blockhash
    const validDevnetBlockhash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

    mockRouter.callWithFailover = async (op) => {
      return op({
        getBlockHeight: async () => 250, // 250 > 200 (expired!)
        getLatestBlockhash: async () => ({
          blockhash: validDevnetBlockhash,
          lastValidBlockHeight: 350,
        }),
        sendRawTransaction: async () => "new_sig",
      } as any, "https://ep1.devnet.solana.com");
    };

    const res = await retryBatch(db, mockRouter, "batch_01", mockKeypair);

    expect(res.status).toBe("expired_rebuilt");

    const batch = db.prepare("SELECT state, attempts, signature, last_valid_block_height FROM batches WHERE id = 'batch_01'").get() as any;
    expect(batch.state).toBe("submitted");
    expect(batch.attempts).toBe(2);
    expect(batch.signature).not.toBe("mock_sig_12345"); // New signature
    expect(batch.last_valid_block_height).toBe(350);

    const rebuiltCounter = getCounter(db, "batches_expired_rebuilt_total");
    expect(rebuiltCounter).toBe(1);
  });

  it("branch 4: max attempts exceeded -> moves to failed_review and flags events", async () => {
    setupBatch(5, 200); // attempts = 5 (MAX_ATTEMPTS)

    vi.spyOn(settleModule, "crossCheckSignatureStatus").mockResolvedValue({
      confirmed: false,
      lied: false,
    });

    const res = await retryBatch(db, mockRouter, "batch_01", mockKeypair, { MAX_ATTEMPTS: 5 });

    expect(res.status).toBe("failed_review");

    const batch = db.prepare("SELECT state FROM batches WHERE id = 'batch_01'").get() as any;
    expect(batch.state).toBe("failed_review");

    const event = db.prepare("SELECT state FROM events WHERE id = 'ev_01'").get() as any;
    expect(event.state).toBe("flagged");

    const auditEntry = db.prepare("SELECT action, detail FROM audit_log WHERE action = 'batch_failed_review'").get() as any;
    expect(auditEntry).toBeDefined();
    expect(auditEntry.detail).toContain("Exceeded max retry attempts");
  });
});
