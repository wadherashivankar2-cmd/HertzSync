import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { RpcRouter } from "../../src/lib/rpc-router";
import { submitBatch, retryBatch } from "../../src/worker/settle";

describe("Blockhash Freshness (Blueprint Section 5.3 & 5.4)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let router: RpcRouter;
  const mockKeypair = Keypair.generate();
  const mockPayeeKeypair = Keypair.generate();

  // Valid base58 blockhashes (excluding 0, O, I, l)
  const blockhash1 = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  const blockhash2 = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    migrate(db);

    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_01', 'Test Biz', 'hash_01', 1000)
    `).run();

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_01', 'biz_01', 'Payee 1', '${mockPayeeKeypair.publicKey.toBase58()}', 1000)
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

  function createBuiltBatch(batchId: string) {
    db.prepare(`
      INSERT INTO batches (
        id, payee_id, total_lamports, event_count, events_hash, state,
        attempts, created_at, updated_at
      ) VALUES (
        ?, 'payee_01', 10000, 1, 'mock_events_hash_123', 'built',
        0, 1000, 1000
      )
    `).run(batchId);
  }

  it("submit step calls the network for a blockhash every time without reusing cached values", async () => {
    createBuiltBatch("batch_01");
    createBuiltBatch("batch_02");

    let blockhashCallCount = 0;
    const providedBlockhashes = [blockhash1, blockhash2];

    router.callWithFailover = async (op) => {
      return op({
        getBalance: async () => 1_000_000_000, // plenty of funds
        getLatestBlockhash: async () => {
          const bh = providedBlockhashes[blockhashCallCount];
          blockhashCallCount++;
          return {
            blockhash: bh,
            lastValidBlockHeight: 100 + blockhashCallCount * 50,
          };
        },
        sendRawTransaction: async () => "mock_tx_sig",
        getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "processed", err: null }] }),
      } as any, "https://ep1.devnet.solana.com");
    };

    // First submission
    const res1 = await submitBatch(db, router, "batch_01", mockKeypair);
    expect(res1.status).toBe("submitted");
    expect(blockhashCallCount).toBe(1);

    const row1 = db.prepare("SELECT last_valid_block_height, serialized_tx FROM batches WHERE id = 'batch_01'").get() as any;
    expect(row1.last_valid_block_height).toBe(150);

    // Second submission must query the network fresh, NOT reuse batch 1's blockhash
    const res2 = await submitBatch(db, router, "batch_02", mockKeypair);
    expect(res2.status).toBe("submitted");
    expect(blockhashCallCount).toBe(2);

    const row2 = db.prepare("SELECT last_valid_block_height, serialized_tx FROM batches WHERE id = 'batch_02'").get() as any;
    expect(row2.last_valid_block_height).toBe(200);

    // Ensure transactions are different and serialized with different blockhashes
    expect(row1.serialized_tx).not.toBe(row2.serialized_tx);
  });

  it("retry after expiry fetches fresh blockhash from network and updates last_valid_block_height", async () => {
    // Insert expired batch
    db.prepare(`
      INSERT INTO batches (
        id, payee_id, total_lamports, event_count, events_hash, state,
        signature, serialized_tx, last_valid_block_height, attempts, created_at, updated_at
      ) VALUES (
        'batch_expired', 'payee_01', 10000, 1, 'mock_events_hash_123', 'submitted',
        'old_sig_12345', 'old_serialized_tx_base64', 100, 1, 1000, 1000
      )
    `).run();

    let freshBlockhashFetched = false;

    router.callWithFailover = async (op) => {
      return op({
        getSignatureStatuses: async () => ({ value: [null] }), // not confirmed
        getBlockHeight: async () => 150, // 150 > 100 (expired!)
        getLatestBlockhash: async () => {
          freshBlockhashFetched = true;
          return {
            blockhash: blockhash2,
            lastValidBlockHeight: 300,
          };
        },
        sendRawTransaction: async () => "new_sig_67890",
      } as any, "https://ep1.devnet.solana.com");
    };

    const res = await retryBatch(db, router, "batch_expired", mockKeypair);
    expect(res.status).toBe("expired_rebuilt");
    expect(freshBlockhashFetched).toBe(true);

    const updated = db.prepare("SELECT * FROM batches WHERE id = 'batch_expired'").get() as any;
    expect(updated.state).toBe("submitted");
    expect(updated.last_valid_block_height).toBe(300);
    expect(updated.signature).not.toBe("old_sig_12345");
  });
});
