import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createDatabaseConnection, truncateCheckpoint } from "../lib/db";
import { RpcRouter } from "../lib/rpc-router";
import { getConfig, Config } from "../lib/config";
import { createBatches } from "./batcher";
import { submitBatch, retryBatch } from "./settle";
import { runReconciliation } from "./reconcile";
import { getSystemState, setSystemState } from "../lib/system-state";
import { setCounter } from "../lib/counters";
import { logger } from "../lib/logger";

export class SettlementWorker {
  private db: Database.Database;
  private router: RpcRouter;
  private config: Config;
  private isStopping: boolean = false;
  private isRunning: boolean = false;
  private inFlightStep: boolean = false;
  private lastReconciliationTime: number = 0;

  constructor(db: Database.Database, router?: RpcRouter, configOverride?: Partial<Config>) {
    this.db = db;
    this.config = { ...getConfig(), ...configOverride };
    this.router = router || new RpcRouter(this.db);
  }

  public getDb(): Database.Database {
    return this.db;
  }

  public getRouter(): RpcRouter {
    return this.router;
  }

  public isTerminating(): boolean {
    return this.isStopping;
  }

  /**
   * Runs the worker startup sequence per Blueprint Section 5.10:
   * 1. PRAGMA integrity_check (quick mode). Refuses to start if corrupt.
   * 2. Verify DevNet cluster genesis hash.
   * 3. Resume batches in 'submitted' or 'retrying'.
   * 4. Run reconciliation once.
   */
  public async startup(): Promise<void> {
    logger.info("Starting Settlement Worker startup checks...");

    // 1. Database integrity check
    const checkRow = this.db.pragma("integrity_check(1)") as { integrity_check: string }[];
    const result = checkRow?.[0]?.integrity_check || "unknown";
    if (result !== "ok") {
      throw new Error(`FATAL: Database integrity check failed: ${result}. Refusing to start worker.`);
    }
    logger.info("SQLite integrity check passed: ok");

    // 2. DevNet cluster verification
    await this.router.verifyDevnetCluster();

    // 3. Resume batches in submitted or retrying
    const activeBatches = this.db.prepare(`
      SELECT id, state
      FROM batches
      WHERE state IN ('submitted', 'retrying')
      ORDER BY created_at ASC
    `).all() as { id: string; state: string }[];

    if (activeBatches.length > 0) {
      logger.info(`Resuming ${activeBatches.length} active unconfirmed batches on startup...`);
      for (const batch of activeBatches) {
        if (this.isStopping) break;
        try {
          await retryBatch(this.db, this.router, batch.id, undefined, this.config);
        } catch (err: any) {
          logger.warn(`Startup resume failed for batch ${batch.id}: ${err.message}`);
        }
      }
    }

    // 4. Run reconciliation once on startup
    runReconciliation(this.db);
    this.lastReconciliationTime = Date.now();
    logger.info("Startup sequence complete. Worker ready.");
  }

  /**
   * Executes a single iteration of the worker processing cycle.
   */
  public async step(): Promise<void> {
    if (this.isStopping) {
      return;
    }

    this.inFlightStep = true;
    try {
      // Step 1: Retry unconfirmed submitted or retrying batches
      const pendingBatches = this.db.prepare(`
        SELECT id
        FROM batches
        WHERE state IN ('submitted', 'retrying')
        ORDER BY updated_at ASC
        LIMIT 10
      `).all() as { id: string }[];

      for (const batch of pendingBatches) {
        if (this.isStopping) break;
        try {
          await retryBatch(this.db, this.router, batch.id, undefined, this.config);
        } catch (err: any) {
          logger.warn(`Retry failed for batch ${batch.id}: ${err.message}`);
        }
      }

      if (this.isStopping) return;

      // Step 2: Batch queued events
      createBatches(this.db, this.config);

      if (this.isStopping) return;

      // Step 3: Submit batches in 'built' state
      const builtBatches = this.db.prepare(`
        SELECT id
        FROM batches
        WHERE state = 'built'
        ORDER BY created_at ASC
        LIMIT 10
      `).all() as { id: string }[];

      for (const batch of builtBatches) {
        if (this.isStopping) break;
        try {
          await submitBatch(this.db, this.router, batch.id, undefined, this.config);
        } catch (err: any) {
          logger.warn(`Submission failed for batch ${batch.id}: ${err.message}`);
        }
      }

      if (this.isStopping) return;

      // Step 3.5: Recovery timer check (Blueprint Phase 7 & Section 8.1)
      const restoreRecord = getSystemState<{ restoredAt?: number }>(this.db, "recovery:restore_time");
      if (restoreRecord?.value?.restoredAt) {
        const queueCounts = this.db.prepare(`
          SELECT COUNT(*) as count FROM events WHERE state IN ('queued', 'batched')
        `).get() as { count: number };

        if (queueCounts.count === 0) {
          const restoredAt = restoreRecord.value.restoredAt;
          const now = Date.now();
          const recoverySeconds = Math.max(1, Math.round((now - restoredAt) / 1000));
          setSystemState(this.db, "recovery:last", { recoverySeconds, restoredAt, queueEmptiedAt: now });
          setCounter(this.db, "recovery_seconds_last", recoverySeconds);
          this.db.prepare("DELETE FROM system_state WHERE key = 'recovery:restore_time'").run();
          logger.info(`Queue recovery complete in ${recoverySeconds}s (recorded in recovery:last)`);
        }
      }

      // Step 4: Run reconciliation if due
      const elapsedSinceReconcile = Date.now() - this.lastReconciliationTime;
      if (elapsedSinceReconcile >= this.config.RECONCILE_INTERVAL_MS) {
        runReconciliation(this.db);
        this.lastReconciliationTime = Date.now();
      }
    } finally {
      this.inFlightStep = false;
    }
  }

  /**
   * Starts the continuous worker loop.
   */
  public async start(): Promise<void> {
    await this.startup();
    this.isRunning = true;

    while (!this.isStopping) {
      await this.step();

      if (this.isStopping) {
        break;
      }

      // Sleep BATCH_INTERVAL_MS in 100ms chunks to allow prompt shutdown
      const sleepTotal = this.config.BATCH_INTERVAL_MS;
      const startSleep = Date.now();
      while (Date.now() - startSleep < sleepTotal && !this.isStopping) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    this.isRunning = false;
    logger.info("Worker loop terminated.");
  }

  /**
   * Gracefully stops the worker process:
   * 1. Sets isStopping = true
   * 2. Waits for any in-flight step to complete (up to SHUTDOWN_GRACE_MS)
   * 3. Runs PRAGMA wal_checkpoint(TRUNCATE) safely
   * 4. Closes the database
   */
  public async stop(graceMs?: number): Promise<void> {
    logger.info("Stop requested. Finishing current step...");
    this.isStopping = true;

    const timeout = graceMs || this.config.SHUTDOWN_GRACE_MS;
    const startWait = Date.now();

    while (this.inFlightStep && Date.now() - startWait < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    try {
      truncateCheckpoint(this.db);
      logger.info("Database checkpointed (TRUNCATE) on clean worker shutdown.");
    } catch (err: any) {
      logger.warn(`TRUNCATE checkpoint during shutdown failed: ${err.message}`);
    }

    try {
      this.db.close();
      logger.info("Worker database connection closed successfully.");
    } catch (err: any) {
      logger.error(`Error closing database: ${err.message}`);
    }
  }
}

// Standalone executable process handling
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

const isMainModule =
  process.env.RUN_WORKER === "true" ||
  process.argv.some(
    (arg) =>
      arg.includes("src/worker") ||
      arg.includes("src\\worker") ||
      arg.endsWith("worker") ||
      arg.endsWith("index.ts")
  );

if (isMainModule) {
  loadEnvLocal();
  const config = getConfig();
  const db = createDatabaseConnection();
  const router = new RpcRouter(db);
  const worker = new SettlementWorker(db, router, config);

  let signalCount = 0;

  const handleSignal = async (sig: string) => {
    signalCount++;
    if (signalCount > 1) {
      logger.warn(`Received second ${sig}. Immediate exit.`);
      process.exit(1);
    }

    logger.info(`Received ${sig}. Initiating graceful shutdown...`);
    await worker.stop(config.SHUTDOWN_GRACE_MS);
    process.exit(0);
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  if (process.send) {
    process.on("message", (msg) => {
      if (msg === "SIGINT" || (typeof msg === "object" && (msg as any)?.type === "SIGINT")) {
        handleSignal("SIGINT");
      } else if (msg === "SIGTERM" || (typeof msg === "object" && (msg as any)?.type === "SIGTERM")) {
        handleSignal("SIGTERM");
      }
    });
  }

  worker.start().catch((err) => {
    logger.error("FATAL: Worker encountered fatal error", { error: err.message, stack: err.stack });
    process.exit(1);
  });
}
