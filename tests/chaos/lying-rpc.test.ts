import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { RpcRouter } from "../../src/lib/rpc-router";
import { retryBatch, crossCheckSignatureStatus } from "../../src/worker/settle";
import { DEVNET_GENESIS_HASH } from "../../src/lib/config";

describe("Lying RPC Chaos Protection (Blueprint Section 5.4, 9, & S9)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let router: RpcRouter;
  const mockKeypair = Keypair.generate();
  const mockPayeeKeypair = Keypair.generate();
  const ep1 = "https://mock-ep-1.devnet.solana.com";
  const ep2 = "https://mock-ep-2.devnet.solana.com";

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
      VALUES ('dev_01', 'biz_01', 'payee_01', 'pub_key_01', 'active', 1000)
    `).run();

    db.prepare(`
      INSERT INTO events (
        id, business_id, device_id, epoch, seq, amount_lamports,
        occurred_at, received_at, payload_hash, signature, state, batch_id
      ) VALUES (
        'ev_lie_01', 'biz_01', 'dev_01', 1, 1, 10000,
        1000, 1000, 'hash_lie', 'sig_lie', 'batched', 'batch_lie_01'
      )
    `).run();

    db.prepare(`
      INSERT INTO batches (
        id, payee_id, total_lamports, event_count, events_hash, state,
        signature, serialized_tx, last_valid_block_height, attempts, created_at, updated_at
      ) VALUES (
        'batch_lie_01', 'payee_01', 10000, 1, 'mock_hash', 'submitted',
        'sig_lying_tx_123', 'mock_serialized_tx', 500, 1, 1000, 1000
      )
    `).run();

    router = new RpcRouter(db, [ep1, ep2], { chaosEnabled: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (db) {
      try {
        db.close();
      } catch {}
    }
  });

  it("detects single lying RPC and refuses to mark batch confirmed or events paid", async () => {
    // 1. Set endpoint 1 to 'lie' mode (simulating rogue or compromised RPC returning fake confirmation)
    router.setChaosMode(ep1, "lie");
    router.setChaosMode(ep2, "off");

    // Endpoint 2 returns truthful status (transaction not confirmed yet)
    router.callWithFailover = async (op) => {
      return op({
        getSignatureStatuses: async () => ({
          value: [{ confirmationStatus: "processed", err: null }],
        }),
        getBlockHeight: async () => 250,
        sendRawTransaction: async () => "sig_lying_tx_123",
      } as any, ep2);
    };

    // Verify crossCheckSignatureStatus flags the lie
    const check = await crossCheckSignatureStatus(router, "sig_lying_tx_123");
    expect(check.lied).toBe(true);
    expect(check.confirmed).toBe(false);

    // 2. Run retryBatch
    const result = await retryBatch(db, router, "batch_lie_01", mockKeypair);

    // Must NOT be confirmed
    expect(result.status).not.toBe("confirmed");

    // Verify database state: batch must NOT be marked confirmed
    const batch = db.prepare("SELECT state FROM batches WHERE id = 'batch_lie_01'").get() as any;
    expect(batch.state).not.toBe("confirmed");

    // Verify database state: event must NOT be marked paid
    const event = db.prepare("SELECT state FROM events WHERE id = 'ev_lie_01'").get() as any;
    expect(event.state).not.toBe("paid");
    expect(event.state).toBe("batched");
  });
});

