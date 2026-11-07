import crypto from "crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Connection } from "@solana/web3.js";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { RpcRouter } from "../../src/lib/rpc-router";
import { loadTreasuryKeypair } from "../../src/lib/solana";
import { SettlementWorker } from "../../src/worker/index";
import { runReconciliation } from "../../src/worker/reconcile";
import { incrementCounter, setCounter } from "../../src/lib/counters";

describe("Outage Chaos & Queue Recovery (Blueprint Section 5.1 & Section 8.1)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let router: RpcRouter;
  let worker: SettlementWorker;
  let workerLoopPromise: Promise<void> | null = null;
  let currentDeviceId: string = "dev_01";
  const realTreasuryKeypair = loadTreasuryKeypair("keys/treasury.json");
  const payeeAddress = realTreasuryKeypair.publicKey.toBase58();
  const ep1 = "https://api.devnet.solana.com";
  const ep2 = "https://api.devnet.solana.com?mirror=1";

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    migrate(db);

    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_01', 'Test Biz', 'hash_01', 1000)
    `).run();

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_01', 'biz_01', 'Treasury Self-Payee', ?, 1000)
    `).run(payeeAddress);

    // Unique run ID per test run (Prompt 10 Item 1)
    const runId = crypto.randomBytes(4).toString("hex");
    currentDeviceId = `dev_outage_${runId}`;

    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES (?, 'biz_01', 'payee_01', 'pub_key_01', 'active', 1000)
    `).run(currentDeviceId);

    router = new RpcRouter(db, [ep1, ep2], { chaosEnabled: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (worker) {
      try {
        await worker.stop();
        if (workerLoopPromise) await workerLoopPromise;
      } catch {}
    }
    if (db) {
      try {
        db.close();
      } catch {}
    }
  });

  function queueEvent(id: string, devId: string, seq: number, lamports: number, timestamp: number) {
    db.prepare(`
      INSERT INTO events (
        id, business_id, device_id, epoch, seq, amount_lamports,
        occurred_at, received_at, payload_hash, signature, state
      ) VALUES (
        ?, 'biz_01', ?, 1, ?, ?,
        ?, ?, 'hash_${id}', 'sig_${id}', 'queued'
      )
    `).run(id, devId, seq, lamports, timestamp, timestamp);
    incrementCounter(db, "generated_by_ingest", 1);
  }

  it("holds endpoints down for a real 20 seconds using chaos, ingests 10 events, verifies null-balance batch, restores with live DevNet balance, and drains queue", async () => {
    // Enforce run cap per test process execution (Blueprint & Phase 4/5 safety rule)
    const maxTransfers = parseInt(process.env.MAX_LIVE_TRANSFERS_PER_TEST_RUN || "1", 10);
    if (maxTransfers === 0) {
      console.log(
        `[Outage Test Notice]: Skipping live DevNet outage test. ` +
        `MAX_LIVE_TRANSFERS_PER_TEST_RUN is set to 0.`
      );
      expect(true).toBe(true);
      return;
    }

    // 1. Initialize worker and launch worker loop in background while endpoints are online
    worker = new SettlementWorker(db, router, {
      BATCH_INTERVAL_MS: 1000,
      RECONCILE_INTERVAL_MS: 30000,
      TREASURY_KEYPAIR_PATH: "keys/treasury.json",
    });
    (worker as any).mockTreasuryKeypair = realTreasuryKeypair;

    workerLoopPromise = worker.start();
    // Allow startup sequence (integrity check, cluster genesis hash verification) to complete
    await new Promise((r) => setTimeout(r, 600));

    // 2. Initiate 20-second outage: set both endpoints to 'down' via chaos while worker loop is running
    const outageStartTimestamp = Date.now();
    router.setChaosMode(ep1, "down");
    router.setChaosMode(ep2, "down");

    // Ingest 10 events during the outage window with unique event IDs
    for (let i = 1; i <= 10; i++) {
      const eventId = `${currentDeviceId}:1:${i}`;
      queueEvent(eventId, currentDeviceId, i, 1000, Date.now());
    }

    // Hold outage for at least 20 full seconds
    const elapsedOutageMs = Date.now() - outageStartTimestamp;
    if (elapsedOutageMs < 20500) {
      await new Promise((r) => setTimeout(r, 20500 - elapsedOutageMs));
    }

    const restoreTimestamp = Date.now();
    const outageDurationMs = restoreTimestamp - outageStartTimestamp;

    // Verify 10 events are queued/batched and check single batch created by running worker
    const batchesDuringOutage = db.prepare("SELECT * FROM batches").all() as any[];
    expect(batchesDuringOutage.length).toBe(1);
    const nullBalanceBatch = batchesDuringOutage[0];
    const nullBalanceBatchId = nullBalanceBatch.id;

    // During outage, batch stays in 'built' because RPC is unreachable (null balance path)
    expect(nullBalanceBatch.state).toBe("built");
    expect(nullBalanceBatch.signature).toBeNull();
    expect(nullBalanceBatch.serialized_tx).toBeNull();

    console.log("OUTAGE_RAW_COUNTS_AND_TIMESTAMPS:", {
      outageStartTimestamp,
      restoreTimestamp,
      realOutageDurationSeconds: outageDurationMs / 1000,
      eventsQueuedDuringOutage: 10,
      nullBalanceBatchId,
      nullBalanceBatchState: nullBalanceBatch.state,
    });

    // 3. Restore endpoints
    router.setChaosMode(ep1, "off");
    router.setChaosMode(ep2, "off");
    router.resetAllBreakers();

    // 4. Live RPC call to DevNet to read real treasury balance (NO injection)
    const conn = new Connection("https://api.devnet.solana.com", "confirmed");
    const rawLiveBalanceLamports = await conn.getBalance(realTreasuryKeypair.publicKey);
    console.log("RAW_LIVE_DEVNET_BALANCE_LAMPORTS:", rawLiveBalanceLamports);
    console.log("RAW_LIVE_DEVNET_BALANCE_SOL:", rawLiveBalanceLamports / 1e9);
    expect(rawLiveBalanceLamports).toBeGreaterThan(100_000_000);

    // 5. Worker continues running in background, drains the queue and confirms on DevNet
    const pollStart = Date.now();
    let confirmedBatch: any = null;
    while (Date.now() - pollStart < 45000) {
      const queuedCount = (db.prepare("SELECT count(*) as count FROM events WHERE state = 'queued'").get() as any).count;
      const b = db.prepare("SELECT * FROM batches WHERE id = ?").get(nullBalanceBatchId) as any;
      if (queuedCount === 0 && b && b.state === "confirmed") {
        confirmedBatch = b;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    const queueEmptyTimestamp = Date.now();
    const realDrainDurationMs = queueEmptyTimestamp - restoreTimestamp;
    const recoverySecondsLast = Math.max(1, Math.round(realDrainDurationMs / 1000));
    setCounter(db, "recovery_seconds_last", recoverySecondsLast);

    console.log("OUTAGE_RESTORE_AND_DRAIN_TIMESTAMPS:", {
      restoreTimestamp,
      queueEmptyTimestamp,
      realDrainDurationMs,
      recoverySecondsLast,
    });

    // 6. Batch Identity and On-Chain Verification
    expect(confirmedBatch).not.toBeNull();
    // Confirmed batch ID MUST match the null-balance batch ID created during outage
    expect(confirmedBatch.id).toBe(nullBalanceBatchId);
    expect(confirmedBatch.state).toBe("confirmed");
    expect(confirmedBatch.signature).toBeTruthy();

    const explorerLink = `https://explorer.solana.com/tx/${confirmedBatch.signature}?cluster=devnet`;
    console.log("OUTAGE_CONFIRMED_BATCH_ID:", confirmedBatch.id);
    console.log("BATCH_ID_MATCHES_NULL_BALANCE_BATCH:", confirmedBatch.id === nullBalanceBatchId);
    console.log("OUTAGE_CONFIRMED_BATCH_SIGNATURE:", confirmedBatch.signature);
    console.log("OUTAGE_EXPLORER_LINK:", explorerLink);

    // Query on-chain memo count
    const recentTreasurySigs = await conn.getSignaturesForAddress(realTreasuryKeypair.publicKey, { limit: 25 });
    const matchingSigs = recentTreasurySigs.filter((s) => s.memo && s.memo.includes(confirmedBatch.id));
    console.log("DEVNET_GET_SIGNATURES_COUNT_FOR_BATCH:", matchingSigs.length);
    expect(matchingSigs.length).toBe(1);

    // 7. Reconciliation
    const rec = runReconciliation(db);
    console.log("OUTAGE_RECONCILIATION_ROW:", JSON.stringify(rec, null, 2));
    expect(rec.lost).toBe(0);
    expect(rec.onchainDuplicates).toBe(0);
    expect(rec.accounted).toBe(10);
    expect(rec.ok).toBe(true);

    // Stop worker cleanly after all checks
    await worker.stop();
    if (workerLoopPromise) await workerLoopPromise;
    workerLoopPromise = null;
  }, 90000);
});
