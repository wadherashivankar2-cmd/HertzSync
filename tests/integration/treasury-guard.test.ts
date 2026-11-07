import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { RpcRouter } from "../../src/lib/rpc-router";
import { submitBatch } from "../../src/worker/settle";
import { logger } from "../../src/lib/logger";

describe("Treasury Guardrails (Blueprint Section 5.3 & S14)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let router: RpcRouter;
  const mockKeypair = Keypair.generate();
  const mockPayeeKeypair = Keypair.generate();

  const validDevnetBlockhash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

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

  function createBuiltBatch(id: string) {
    db.prepare(`
      INSERT INTO batches (
        id, payee_id, total_lamports, event_count, events_hash, state,
        attempts, created_at, updated_at
      ) VALUES (
        ?, 'payee_01', 10000, 1, 'mock_hash', 'built',
        0, 1000, 1000
      )
    `).run(id);
  }

  it("blocks sends and logs plain English warning when treasury is empty (0 lamports)", async () => {
    createBuiltBatch("batch_low_01");

    const warnSpy = vi.spyOn(logger, "warn");

    router.callWithFailover = async (op) => {
      return op({
        getBalance: async () => 0, // Empty balance
      } as any, "https://ep1.devnet.solana.com");
    };

    const res = await submitBatch(db, router, "batch_low_01", mockKeypair, {
      TREASURY_MIN_LAMPORTS: 100_000_000,
    });

    expect(res.status).toBe("skipped_treasury_low");

    // Verify plain English log
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Treasury balance (0 lamports) is below minimum threshold 100000000 lamports. Batch batch_low_01 will wait.")
    );

    // Verify batch was NOT submitted or signed
    const batch = db.prepare("SELECT * FROM batches WHERE id = 'batch_low_01'").get() as any;
    expect(batch.state).toBe("built");
    expect(batch.signature).toBeNull();
    expect(batch.serialized_tx).toBeNull();
  });

  it("blocks sends when treasury balance is below TREASURY_MIN_LAMPORTS threshold", async () => {
    createBuiltBatch("batch_low_02");

    router.callWithFailover = async (op) => {
      return op({
        getBalance: async () => 50_000_000, // Below 100_000_000 min
      } as any, "https://ep1.devnet.solana.com");
    };

    const res = await submitBatch(db, router, "batch_low_02", mockKeypair, {
      TREASURY_MIN_LAMPORTS: 100_000_000,
    });

    expect(res.status).toBe("skipped_treasury_low");

    const batch = db.prepare("SELECT * FROM batches WHERE id = 'batch_low_02'").get() as any;
    expect(batch.state).toBe("built");
  });

  it("allows send when treasury balance satisfies TREASURY_MIN_LAMPORTS", async () => {
    createBuiltBatch("batch_funded_01");

    router.callWithFailover = async (op) => {
      return op({
        getBalance: async () => 200_000_000, // Above min
        getLatestBlockhash: async () => ({
          blockhash: validDevnetBlockhash,
          lastValidBlockHeight: 500,
        }),
        sendRawTransaction: async () => "sig_funded_tx_123",
        getSignatureStatuses: async () => ({
          value: [{ confirmationStatus: "processed", err: null }],
        }),
      } as any, "https://ep1.devnet.solana.com");
    };

    const res = await submitBatch(db, router, "batch_funded_01", mockKeypair, {
      TREASURY_MIN_LAMPORTS: 100_000_000,
    });

    expect(res.status).toBe("submitted");

    const batch = db.prepare("SELECT * FROM batches WHERE id = 'batch_funded_01'").get() as any;
    expect(batch.state).toBe("submitted");
    expect(batch.signature).toBeTruthy();
    expect(batch.serialized_tx).toBeTruthy();
  });

  it("fails if a batch with a null balance is broadcast (balance unreadable / RPC unreachable)", async () => {
    createBuiltBatch("batch_null_balance_01");

    let broadcastAttempted = false;
    let blockhashFetched = false;

    // Simulate RPC returning null balance (unreachable or unreadable)
    router.callWithFailover = async (op) => {
      // Spying on operations: if any op tries to fetch blockhash or send raw tx, flag it!
      const mockConn = {
        getBalance: async () => null,
        getLatestBlockhash: async () => {
          blockhashFetched = true;
          return { blockhash: validDevnetBlockhash, lastValidBlockHeight: 500 };
        },
        sendRawTransaction: async () => {
          broadcastAttempted = true;
          return "illegal_signature";
        },
      };
      // getBalanceSafe calls router.callWithFailover and returns null
      return null;
    };

    const res = await submitBatch(db, router, "batch_null_balance_01", mockKeypair, {
      TREASURY_MIN_LAMPORTS: 100_000_000,
    });

    // 1. Must return skipped status
    expect(res.status).toBe("skipped_treasury_low");

    // 2. Fails if broadcast or signing was attempted
    expect(broadcastAttempted).toBe(false);
    expect(blockhashFetched).toBe(false);

    // 3. Batch must strictly stay in its current state ('built') without signature or serialized tx
    const batch = db.prepare("SELECT * FROM batches WHERE id = 'batch_null_balance_01'").get() as any;
    expect(batch.state).toBe("built");
    expect(batch.signature).toBeNull();
    expect(batch.serialized_tx).toBeNull();
    expect(batch.attempts).toBe(0);
  });
});

