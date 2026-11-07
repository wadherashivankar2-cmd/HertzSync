import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { RpcRouter } from "../../src/lib/rpc-router";
import { DEVNET_GENESIS_HASH } from "../../src/lib/config";
import { SettlementWorker } from "../../src/worker/index";
import { runReconciliation } from "../../src/worker/reconcile";
import { incrementCounter } from "../../src/lib/counters";

describe("Settlement Worker Integration (Blueprint Section 5)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let router: RpcRouter;
  const mockPayeeKeypair = Keypair.generate();
  const mockTreasuryKeypair = Keypair.generate();

  const validDevnetBlockhash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    migrate(db);

    // Business
    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_01', 'Test Biz', 'hash_01', 1000)
    `).run();

    // Payee
    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_01', 'biz_01', 'Payee Site 1', '${mockPayeeKeypair.publicKey.toBase58()}', 1000)
    `).run();

    // Device
    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES ('dev_01', 'biz_01', 'payee_01', 'pub_key_01', 'active', 1000)
    `).run();

    router = new RpcRouter(db, ["https://ep1.devnet.solana.com", "https://ep2.devnet.solana.com"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (db) {
      try {
        db.close();
      } catch {}
    }
  });

  function insertQueuedEvent(id: string, seq: number, lamports: number) {
    db.prepare(`
      INSERT INTO events (
        id, business_id, device_id, epoch, seq, amount_lamports,
        occurred_at, received_at, payload_hash, signature, state
      ) VALUES (
        ?, 'biz_01', 'dev_01', 1, ?, ?,
        1000, 1000, 'hash_${id}', 'sig_${id}', 'queued'
      )
    `).run(id, seq, lamports);
    incrementCounter(db, "generated_by_ingest", 1);
  }

  it("completes full lifecycle: queued -> batched -> submitted -> paid with mocked RPC", async () => {
    // 1. Ingest 3 events
    insertQueuedEvent("ev_01", 1, 10000);
    insertQueuedEvent("ev_02", 2, 15000);
    insertQueuedEvent("ev_03", 3, 25000);

    let isConfirmed = false;

    router.callWithFailover = async (op) => {
      return op({
        getGenesisHash: async () => DEVNET_GENESIS_HASH,
        getBalance: async () => 500_000_000, // 0.5 SOL
        getLatestBlockhash: async () => ({
          blockhash: validDevnetBlockhash,
          lastValidBlockHeight: 500,
        }),
        getBlockHeight: async () => 200,
        sendRawTransaction: async () => "mock_worker_tx_signature_12345",
        getSignatureStatuses: async () => ({
          value: isConfirmed
            ? [{ confirmationStatus: "confirmed", err: null }]
            : [{ confirmationStatus: "processed", err: null }],
        }),
      } as any, "https://ep1.devnet.solana.com");
    };

    const worker = new SettlementWorker(db, router, {
      TREASURY_KEYPAIR_PATH: "keys/treasury.json",
      RECONCILE_INTERVAL_MS: 0, // run reconcile every step
    });

    // Provide mock treasury keypair for tests
    (worker as any).mockTreasuryKeypair = mockTreasuryKeypair;

    // Run startup
    await worker.startup();

    // Verify initial reconciliation summary
    let summary = runReconciliation(db);
    expect(summary.accounted).toBe(3);
    expect(summary.lost).toBe(0);

    // Initial check: all 3 are queued
    const queuedCountBefore = db.prepare("SELECT count(*) as c FROM events WHERE state = 'queued'").get() as any;
    expect(queuedCountBefore.c).toBe(3);

    // Step 1: worker builds batch and submits (tx unconfirmed initially)
    await worker.step();

    // Check batch created and submitted
    const batchesAfterStep1 = db.prepare("SELECT * FROM batches").all() as any[];
    expect(batchesAfterStep1.length).toBe(1);
    expect(batchesAfterStep1[0].state).toBe("submitted");
    expect(batchesAfterStep1[0].event_count).toBe(3);
    expect(batchesAfterStep1[0].total_lamports).toBe(50000);

    // Check events transitioned from 'queued' to 'batched'
    const batchedEvents = db.prepare("SELECT count(*) as c FROM events WHERE state = 'batched'").get() as any;
    expect(batchedEvents.c).toBe(3);

    // Now simulate on-chain confirmation
    isConfirmed = true;

    // Step 2: worker retries pending batch, sees confirmed on chain, finalizes payment
    await worker.step();

    // Verify batch is now 'confirmed'
    const batchFinal = db.prepare("SELECT * FROM batches WHERE id = ?").get(batchesAfterStep1[0].id) as any;
    expect(batchFinal.state).toBe("confirmed");

    // Verify all 3 events are 'paid'
    const paidEvents = db.prepare("SELECT count(*) as c FROM events WHERE state = 'paid'").get() as any;
    expect(paidEvents.c).toBe(3);

    // Verify reconciliation summary proves 0 lost and full accounting
    summary = runReconciliation(db);
    expect(summary.accounted).toBe(3);
    expect(summary.lost).toBe(0);
    expect(summary.paid).toBe(3);
  });
});
