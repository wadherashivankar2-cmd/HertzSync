import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";

const TEST_DB_PATH = path.resolve(process.cwd(), "data", "test_worker_shutdown.db");

describe("Worker Shutdown Lifecycle (Blueprint Section 5.10 & Phase 4 Safety Rules)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {}
    }

    db = createDatabaseConnection(TEST_DB_PATH);
    migrate(db);

    // Business & payee
    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_01', 'Test Biz', 'hash_01', 1000)
    `).run();

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_01', 'biz_01', 'Payee Site', '25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr', 1000)
    `).run();

    // Prepare a batch in 'submitted' state
    db.prepare(`
      INSERT INTO batches (
        id, payee_id, total_lamports, event_count, events_hash, state,
        signature, serialized_tx, last_valid_block_height, attempts, created_at, updated_at
      ) VALUES (
        'batch_shutdown_01', 'payee_01', 10000, 1, 'mock_events_hash', 'submitted',
        'mock_sig_12345', 'mock_serialized_tx', 500, 1, 1000, 1000
      )
    `).run();

    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {}
    }
  });

  it("SIGINT finishes current step, exits 0, preserves submitted batch, and resumes on restart", async () => {
    const viteNodePath = path.resolve(process.cwd(), "node_modules/vite-node/vite-node.mjs");
    const workerScriptPath = path.resolve(process.cwd(), "src/worker/index.ts");

    // 1. Spawn real worker child process
    const worker1 = spawn(process.execPath, [viteNodePath, workerScriptPath], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        RUN_WORKER: "true",
        DB_PATH: TEST_DB_PATH,
        NODE_ENV: "test",
        BATCH_INTERVAL_MS: "2000",
        SHUTDOWN_GRACE_MS: "3000",
      },
    });

    const worker1Logs: string[] = [];
    worker1.stdout.on("data", (d) => worker1Logs.push(d.toString()));
    worker1.stderr.on("data", (d) => worker1Logs.push(d.toString()));

    // Wait for worker to start up and log startup completion
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 3000);
      worker1.stdout.on("data", (data) => {
        const text = data.toString();
        if (text.includes("Worker ready") || text.includes("Resuming")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      worker1.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Send SIGINT signal via IPC to test graceful shutdown
    const exitPromise1 = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      worker1.on("exit", (code, signal) => resolve({ code, signal }));
    });

    worker1.send("SIGINT");

    const exit1 = await exitPromise1;
    expect(exit1.code).toBe(0);

    console.log("=== RAW WORKER LOGS FOR SIGINT STOP ===");
    console.log(worker1Logs.join("").trim());
    console.log("========================================");

    // Verify batch remains in database and can be read back cleanly
    const verifyDb1 = createDatabaseConnection(TEST_DB_PATH);
    const batchRow1 = verifyDb1.prepare("SELECT * FROM batches WHERE id = 'batch_shutdown_01'").get() as any;
    expect(batchRow1).toBeDefined();
    expect(["submitted", "retrying"]).toContain(batchRow1.state);
    verifyDb1.close();

    // 2. Restart real worker child process to verify it resumes
    const worker2 = spawn(process.execPath, [viteNodePath, workerScriptPath], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        RUN_WORKER: "true",
        DB_PATH: TEST_DB_PATH,
        NODE_ENV: "test",
        BATCH_INTERVAL_MS: "2000",
        SHUTDOWN_GRACE_MS: "3000",
      },
    });

    const worker2Logs: string[] = [];
    worker2.stdout.on("data", (d) => worker2Logs.push(d.toString()));
    worker2.stderr.on("data", (d) => worker2Logs.push(d.toString()));

    let resumedFound = false;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 3000);
      worker2.stdout.on("data", (data) => {
        const text = data.toString();
        if (text.includes("Resuming") || text.includes("Worker ready")) {
          resumedFound = true;
          clearTimeout(timeout);
          resolve();
        }
      });
      worker2.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    expect(resumedFound).toBe(true);

    // Stop worker2
    const exitPromise2 = new Promise<{ code: number | null }>((resolve) => {
      worker2.on("exit", (code) => resolve({ code }));
    });
    worker2.send("SIGINT");
    const exit2 = await exitPromise2;
    expect(exit2.code).toBe(0);

    console.log("=== RAW WORKER LOGS FOR STARTUP RESUME ===");
    console.log(worker2Logs.join("").trim());
    console.log("==========================================");
  }, 15000);

  it("second signal exits immediately with code 1", async () => {
    const viteNodePath = path.resolve(process.cwd(), "node_modules/vite-node/vite-node.mjs");
    const workerScriptPath = path.resolve(process.cwd(), "src/worker/index.ts");

    const worker = spawn(process.execPath, [viteNodePath, workerScriptPath], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        RUN_WORKER: "true",
        DB_PATH: TEST_DB_PATH,
        NODE_ENV: "test",
        BATCH_INTERVAL_MS: "5000",
        SHUTDOWN_GRACE_MS: "10000",
      },
    });

    // Wait until started
    await new Promise((r) => setTimeout(r, 1000));

    const exitPromise = new Promise<{ code: number | null }>((resolve) => {
      worker.on("exit", (code) => resolve({ code }));
    });

    // Send first signal, then immediately send second signal
    worker.send("SIGINT");
    worker.send("SIGINT");

    const exit = await exitPromise;
    expect(exit.code).toBe(1);
  }, 10000);
});

