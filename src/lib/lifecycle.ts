import { logger } from "./logger";
import { closeDb, truncateCheckpoint, getDb } from "./db";
import { getConfig } from "./config";

let isTerminating = false;
let inFlightRequests = 0;
let signalCount = 0;

export function isShuttingDown(): boolean {
  return isTerminating;
}

export function trackInFlightRequest(): () => void {
  inFlightRequests++;
  return () => {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
  };
}

export function getInFlightRequestsCount(): number {
  return inFlightRequests;
}

/**
 * Executes graceful shutdown sequence for the process.
 * Section 5.10:
 * 1. isShuttingDown = true
 * 2. Finish current step / wait for in-flight requests up to SHUTDOWN_GRACE_MS
 * 3. Run wal_checkpoint(TRUNCATE) safely after writers stop
 * 4. Close database and exit 0
 * 5. If a second signal arrives, exit 1 immediately
 */
export function handleShutdownSignal(signal: string, onExit?: (code: number) => void): void {
  signalCount++;

  if (signalCount > 1) {
    logger.warn(`Received second ${signal}. Forcing immediate shutdown.`);
    if (onExit) {
      onExit(1);
    } else {
      process.exit(1);
    }
    return;
  }

  isTerminating = true;
  logger.info(`Received ${signal}. Stop requested. Waiting for in-flight work to complete...`);

  let graceMs = 10000;
  try {
    graceMs = getConfig().SHUTDOWN_GRACE_MS;
  } catch {
    // fallback default
  }

  const startTime = Date.now();

  const checkInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    if (inFlightRequests === 0 || elapsed >= graceMs) {
      clearInterval(checkInterval);

      if (inFlightRequests > 0) {
        logger.warn(`Grace period expired with ${inFlightRequests} in-flight requests. Proceeding to shutdown.`);
      } else {
        logger.info("All in-flight requests completed cleanly.");
      }

      try {
        const db = getDb();
        truncateCheckpoint(db);
        closeDb();
        logger.info("Database checkpointed and closed successfully.");
      } catch (err: any) {
        logger.error("Error closing database during shutdown", { error: err.message });
      }

      if (onExit) {
        onExit(0);
      } else {
        process.exit(0);
      }
    }
  }, 100);
}

export function registerLifecycleHooks(): void {
  if (process.env.NODE_ENV !== "test") {
    process.on("SIGINT", () => handleShutdownSignal("SIGINT"));
    process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));
  }
}

