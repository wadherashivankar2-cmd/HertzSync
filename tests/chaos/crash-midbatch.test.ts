import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { runReconciliation } from "../../src/worker/reconcile";
import { incrementCounter } from "../../src/lib/counters";

const TEST_DB_PATH = path.resolve(process.cwd(), "data", "test_crash_midbatch.db");
const REAL_LOG_PATH = path.resolve(process.cwd(), "data", "logs", "worker_real.log");

describe("Crash Mid-Batch Chaos (Blueprint Section 5.10 & Phase 4 Safety Rules)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {}
    }

    db = createDatabaseConnection(TEST_DB_PATH);
    migrate(db);

    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_01', 'Test Biz', 'hash_01', 1000)
    `).run();

    // Payee is the funded DevNet treasury address so funds cycle safely
    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_01', 'biz_01', 'Payee Site', '25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr', 1000)
    `).run();

    // Unique run identifier per test execution (Prompt 10 Item 1)
    const runId = crypto.randomBytes(4).toString("hex");
    const deviceId = `dev_crash_${runId}`;

    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES (?, 'biz_01', 'payee_01', 'pub_01', 'active', 1000)
    `).run(deviceId);

    // Insert 3 queued events with unique event IDs per run
    for (let i = 1; i <= 3; i++) {
      const eventId = `${deviceId}:1:${i}`;
      db.prepare(`
        INSERT INTO events (
          id, business_id, device_id, epoch, seq, amount_lamports,
          occurred_at, received_at, payload_hash, signature, state
        ) VALUES (
          ?, 'biz_01', ?, 1, ?, 10000,
          1000, 1000, ?, ?, 'queued'
        )
      `).run(eventId, deviceId, i, `hash_${eventId}`, `sig_${eventId}`);
      incrementCounter(db, "generated_by_ingest", 1);
    }

    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {}
    }
  });

  it("survives SIGKILL after submit and before confirm, restarts, and reconciles 0 lost and 0 onchain duplicates", async () => {
    // Enforce run cap per test process execution (Blueprint & Phase 4/5 safety rule)
    const maxTransfers = parseInt(process.env.MAX_LIVE_TRANSFERS_PER_TEST_RUN || "1", 10);
    if (maxTransfers === 0) {
      console.log(
        `[Crash Test Notice]: Skipping live DevNet crash test. ` +
        `MAX_LIVE_TRANSFERS_PER_TEST_RUN is set to 0.`
      );
      expect(true).toBe(true);
      return;
    }

    const viteNodePath = path.resolve(process.cwd(), "node_modules/vite-node/vite-node.mjs");
    const workerScriptPath = path.resolve(process.cwd(), "src/worker/index.ts");

    // 1. Spawn real worker child process (worker1)
    const worker1 = spawn(process.execPath, [viteNodePath, workerScriptPath], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        RUN_WORKER: "true",
        DB_PATH: TEST_DB_PATH,
        NODE_ENV: "test",
        BATCH_INTERVAL_MS: "1000",
        SHUTDOWN_GRACE_MS: "2000",
      },
    });

    const worker1Logs: string[] = [];
    worker1.stdout.on("data", (d) => worker1Logs.push(d.toString()));
    worker1.stderr.on("data", (d) => worker1Logs.push(d.toString()));

    // Wait until worker1 submits the batch (persisted & broadcast initiated), then immediately SIGKILL
    await new Promise<void>((resolve, reject) => {
      let killed = false;
      const timeout = setTimeout(() => {
        if (!killed) {
          worker1.kill("SIGKILL");
          resolve();
        }
      }, 10000);

      worker1.stdout.on("data", (data) => {
        const text = data.toString();
        if (text.includes("signed and persisted. Broadcasting signature:")) {
          // SIGKILL immediately after submit, before confirm per Blueprint Section 10!
          killed = true;
          clearTimeout(timeout);
          worker1.kill("SIGKILL");
          resolve();
        }
      });

      worker1.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Ensure worker 1 is fully dead
    await new Promise((r) => setTimeout(r, 600));

    console.log("=== RAW WORKER LOGS FROM REAL SIGKILL PROCESS (worker1 - NO SIGINT) ===");
    console.log(worker1Logs.join("").trim());
    console.log("======================================================================");

    // Save worker 1 log
    fs.mkdirSync(path.dirname(REAL_LOG_PATH), { recursive: true });
    fs.writeFileSync(REAL_LOG_PATH, worker1Logs.join(""), "utf8");

    // Verify DB state immediately after crash: batch was persisted and serialized before crash
    const dbPostCrash = createDatabaseConnection(TEST_DB_PATH);
    const batches = dbPostCrash.prepare("SELECT * FROM batches").all() as any[];
    expect(batches.length).toBe(1);
    expect(["built", "submitted"]).toContain(batches[0].state);

    if (batches[0].state === "submitted") {
      expect(batches[0].signature).toBeTruthy();
      expect(batches[0].serialized_tx).toBeTruthy();
    }
    const preRestartBatchId = batches[0].id;
    const batchBeforeRestart = dbPostCrash.prepare("SELECT * FROM batches WHERE id = ?").get(preRestartBatchId) as any;
    const serializedTxHashBeforeKill = batchBeforeRestart.serialized_tx
      ? crypto.createHash("sha256").update(Buffer.from(batchBeforeRestart.serialized_tx, "base64")).digest("hex")
      : null;

    console.log("CRASH_BATCH_ID_BEFORE_KILL:", batchBeforeRestart.id);
    console.log("BEFORE_KILL_SIGNATURE:", batchBeforeRestart.signature);
    console.log("BEFORE_KILL_SERIALIZED_TX_HASH:", serializedTxHashBeforeKill);

    dbPostCrash.close();

    // 2. Restart real worker child process (worker2) to resume and confirm on DevNet
    const worker2 = spawn(process.execPath, [viteNodePath, workerScriptPath], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        RUN_WORKER: "true",
        DB_PATH: TEST_DB_PATH,
        NODE_ENV: "test",
        BATCH_INTERVAL_MS: "1000",
        SHUTDOWN_GRACE_MS: "2000",
      },
    });

    const worker2Logs: string[] = [];
    worker2.stdout.on("data", (d) => worker2Logs.push(d.toString()));
    worker2.stderr.on("data", (d) => worker2Logs.push(d.toString()));

    // Let worker2 run through startup, resume the unconfirmed batch, and wait until confirmed on DevNet
    await new Promise<void>((resolve, reject) => {
      const pollInterval = setInterval(() => {
        try {
          const pollDb = createDatabaseConnection(TEST_DB_PATH);
          const b = pollDb.prepare("SELECT state FROM batches WHERE id = ?").get(preRestartBatchId) as any;
          pollDb.close();
          if (b && b.state === "confirmed") {
            clearInterval(pollInterval);
            resolve();
          }
        } catch {}
      }, 500);

      const timeout = setTimeout(() => {
        clearInterval(pollInterval);
        resolve();
      }, 30000);

      worker2.on("error", (err) => {
        clearInterval(pollInterval);
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Gracefully stop worker2 after confirmation
    const exit2Promise = new Promise<{ code: number | null }>((resolve) => {
      worker2.on("exit", (code) => resolve({ code }));
    });
    worker2.send("SIGINT");
    await exit2Promise;

    console.log("=== RAW WORKER LOGS FOR RESUME & CONFIRMATION (worker2) ===");
    console.log(worker2Logs.join("").trim());
    console.log("===========================================================");

    // Append worker 2 log to REAL_LOG_PATH
    fs.appendFileSync(REAL_LOG_PATH, "\n" + worker2Logs.join(""), "utf8");

    // 3. Post-recovery verification
    const verifyDb = createDatabaseConnection(TEST_DB_PATH);

    // Verify batch reached status "confirmed"
    const confirmedBatch = verifyDb.prepare("SELECT * FROM batches WHERE id = ?").get(preRestartBatchId) as any;
    expect(confirmedBatch.state).toBe("confirmed");
    expect(confirmedBatch.signature).toBeTruthy();

    const serializedTxHashAfterRestart = confirmedBatch.serialized_tx
      ? crypto.createHash("sha256").update(Buffer.from(confirmedBatch.serialized_tx, "base64")).digest("hex")
      : null;

    console.log("CRASH_BATCH_ID_AFTER_RESTART:", confirmedBatch.id);
    console.log("AFTER_RESTART_SIGNATURE:", confirmedBatch.signature);
    console.log("AFTER_RESTART_SERIALIZED_TX_HASH:", serializedTxHashAfterRestart);

    // Confirm that signature and serialized_tx are identical before kill and after restart (NO REBUILD!)
    expect(confirmedBatch.signature).toBe(batchBeforeRestart.signature);
    expect(serializedTxHashAfterRestart).toBe(serializedTxHashBeforeKill);

    const explorerLink = `https://explorer.solana.com/tx/${confirmedBatch.signature}?cluster=devnet`;
    console.log("CRASH_TEST_CONFIRMED_BATCH_ID:", confirmedBatch.id);
    console.log("CRASH_TEST_CONFIRMED_SIGNATURE:", confirmedBatch.signature);
    console.log("CRASH_TEST_EXPLORER_LINK:", explorerLink);

    // Verify on live DevNet that transaction is confirmed and contains the real batch ULID memo
    const conn = new Connection("https://api.devnet.solana.com", "confirmed");
    const onchainStatus = await conn.getSignatureStatus(confirmedBatch.signature, { searchTransactionHistory: true });
    expect(onchainStatus.value).not.toBeNull();
    expect(["confirmed", "finalized"]).toContain(onchainStatus.value?.confirmationStatus);

    // Verify memo on-chain contains the real generated batch ULID (not TESTBATCH01)
    const onchainTx = await conn.getTransaction(confirmedBatch.signature, { maxSupportedTransactionVersion: 0 });
    expect(onchainTx).not.toBeNull();
    const memoPrefix = `trickle:v1:${confirmedBatch.id}:`;
    const memoLog = onchainTx?.meta?.logMessages?.find((m) => m.includes(memoPrefix));
    expect(memoLog).toBeDefined();
    console.log("CRASH_TEST_DEVNET_MEMO_LOG:", memoLog);

    // Verify this batch appears on-chain exactly once across recent treasury transactions
    const recentTreasurySigs = await conn.getSignaturesForAddress(
      new PublicKey("25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr"),
      { limit: 20 }
    );
    const matchingMemoCount = recentTreasurySigs.filter(
      (s) => s.memo && s.memo.includes(confirmedBatch.id)
    ).length;
    expect(matchingMemoCount).toBe(1);
    console.log(`CRASH_TEST_ONCHAIN_BATCH_COUNT: Batch ${confirmedBatch.id} appears on-chain exactly ${matchingMemoCount} time.`);

    // Verify every event appears in exactly one batch and is marked paid
    const eventCounts = verifyDb.prepare(`
      SELECT id, count(batch_id) as batch_count, state
      FROM events
      GROUP BY id
    `).all() as { id: string; batch_count: number; state: string }[];

    for (const ec of eventCounts) {
      expect(ec.batch_count).toBe(1);
      expect(ec.state).toBe("paid");
    }

    // Run reconciliation and verify 0 lost and 0 onchain duplicates
    const rec = runReconciliation(verifyDb);
    console.log("CRASH_RECONCILIATION_ROW:", JSON.stringify(rec, null, 2));

    const dbReconcileRow = verifyDb.prepare(`
      SELECT * FROM reconciliations ORDER BY run_at DESC LIMIT 1
    `).get() as any;
    console.log("CRASH_RECONCILIATIONS_DB_ROW:", JSON.stringify(dbReconcileRow, null, 2));

    expect(rec.lost).toBe(0);
    expect(rec.onchainDuplicates).toBe(0);
    expect(rec.accounted).toBe(3);
    expect(rec.ok).toBe(true);

    verifyDb.close();
  }, 45000);
});
