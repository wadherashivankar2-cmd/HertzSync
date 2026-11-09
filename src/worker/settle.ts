import Database from "better-sqlite3";
import { Keypair } from "@solana/web3.js";
import { RpcRouter } from "../lib/rpc-router";
import {
  getFreshBlockhash,
  buildSettlementTx,
  getBalanceSafe,
  loadTreasuryKeypair,
} from "../lib/solana";
import { buildBatchMemo, MEMO_MAX_BYTES } from "../lib/ids";
import { getConfig, Config } from "../lib/config";
import { incrementCounter } from "../lib/counters";
import { writeAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

export interface SettleBatchResult {
  batchId: string;
  status: "confirmed" | "submitted" | "retrying" | "expired_rebuilt" | "failed_review" | "skipped_treasury_low";
  signature?: string;
  error?: string;
}

export interface SignatureCrossCheckResult {
  confirmed: boolean;
  lied: boolean;
  fallback?: boolean;
  singleEndpointFallback?: boolean;
  independentCheck?: boolean;
  endpointsChecked?: string[];
}

/**
 * Checks signature status across two strictly distinct endpoints to prevent single lying RPC exploits (S9).
 * First check is forced on endpoint index 0 (primary).
 * Second check is explicitly forced on a distinct endpoint index (e.g. index 1).
 * If only one endpoint exists or responds, returns an explicit status/flag indicating
 * singleEndpointFallback: true, and does NOT count it as an independent cross-check (independentCheck: false).
 */
export async function crossCheckSignatureStatus(
  router: RpcRouter,
  signature: string
): Promise<SignatureCrossCheckResult> {
  const endpoints = router.getEndpoints();
  if (endpoints.length === 0) {
    return {
      confirmed: false,
      lied: false,
      fallback: true,
      singleEndpointFallback: true,
      independentCheck: false,
      endpointsChecked: [],
    };
  }

  // Helper to query signature status on a specific endpoint
  async function queryEndpointStatus(ep: string): Promise<boolean | null> {
    if (!router.isEndpointAvailable(ep)) {
      return null;
    }
    const chaos = router.getChaosMode(ep);
    if (chaos === "lie") {
      return true;
    }
    try {
      const res = await router.callEndpoint(ep, async (conn) => {
        return await conn.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
      });
      if (!res) {
        return null;
      }
      const st = res.value?.[0];
      if (!st) {
        // null or undefined means signature not found on this endpoint yet
        return false;
      }
      const isConfirmed =
        (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") &&
        st.err === null;
      return isConfirmed;
    } catch {
      return null;
    }
  }

  // 1. Force the first check on endpoint index 0 (primary)
  const primaryEndpoint = endpoints[0];
  const primaryStatus = await queryEndpointStatus(primaryEndpoint);

  // 2. Explicitly force the second check on a distinct endpoint (index >= 1, ep !== primaryEndpoint)
  const secondaryEndpoints = endpoints.filter((ep, idx) => idx > 0 && ep !== primaryEndpoint);
  let secondaryEndpoint: string | null = null;
  let secondaryStatus: boolean | null = null;

  for (const ep of secondaryEndpoints) {
    const status = await queryEndpointStatus(ep);
    if (status !== null) {
      secondaryEndpoint = ep;
      secondaryStatus = status;
      break;
    }
  }

  // Case 1: Both distinct endpoints responded -> independent quorum verification
  if (primaryStatus !== null && secondaryStatus !== null && secondaryEndpoint !== null) {
    const endpointsChecked = [primaryEndpoint, secondaryEndpoint];
    if (primaryStatus !== secondaryStatus) {
      logger.warn(
        `Signature ${signature} confirmation mismatch between distinct endpoints (${primaryEndpoint}: ${primaryStatus} vs ${secondaryEndpoint}: ${secondaryStatus}). Potential lying RPC detected.`
      );
      return {
        confirmed: false,
        lied: true,
        fallback: false,
        singleEndpointFallback: false,
        independentCheck: true,
        endpointsChecked,
      };
    }
    return {
      confirmed: primaryStatus && secondaryStatus,
      lied: false,
      fallback: false,
      singleEndpointFallback: false,
      independentCheck: true,
      endpointsChecked,
    };
  }

  // Case 2: Only primary responded (no secondary configured or secondary failed)
  if (primaryStatus !== null) {
    logger.warn(
      `Only primary RPC endpoint (${primaryEndpoint}) responded for signature ${signature}. Operating in unverified single-endpoint fallback mode.`
    );
    return {
      confirmed: primaryStatus,
      lied: false,
      fallback: true,
      singleEndpointFallback: true,
      independentCheck: false,
      endpointsChecked: [primaryEndpoint],
    };
  }

  // Case 3: Primary failed, but a secondary endpoint responded
  if (secondaryStatus !== null && secondaryEndpoint !== null) {
    logger.warn(
      `Primary RPC endpoint failed; only secondary endpoint (${secondaryEndpoint}) responded for signature ${signature}. Operating in unverified single-endpoint fallback mode.`
    );
    return {
      confirmed: secondaryStatus,
      lied: false,
      fallback: true,
      singleEndpointFallback: true,
      independentCheck: false,
      endpointsChecked: [secondaryEndpoint],
    };
  }

  // Case 4: Neither endpoint responded
  logger.warn(`No RPC endpoints responded for signature ${signature}.`);
  return {
    confirmed: false,
    lied: false,
    fallback: true,
    singleEndpointFallback: true,
    independentCheck: false,
    endpointsChecked: [],
  };
}

/**
 * Submits a newly built batch to Solana DevNet with a fresh blockhash.
 * Blueprint Section 5.3.
 */
export async function submitBatch(
  db: Database.Database,
  router: RpcRouter,
  batchId: string,
  treasuryKeypairOverride?: Keypair,
  configOverride?: Partial<Config>
): Promise<SettleBatchResult> {
  const config = { ...getConfig(), ...configOverride };

  // Fetch batch row with payee's solana address
  const batchRow = db.prepare(`
    SELECT b.*, p.solana_address
    FROM batches b
    JOIN payees p ON b.payee_id = p.id
    WHERE b.id = ?
  `).get(batchId) as any;

  if (!batchRow) {
    throw new Error(`Batch ${batchId} not found in database.`);
  }

  const treasuryKeypair = treasuryKeypairOverride || loadTreasuryKeypair(config.TREASURY_KEYPAIR_PATH);

  // 1. Check treasury balance against TREASURY_MIN_LAMPORTS (S14)
  const balance = await getBalanceSafe(router, treasuryKeypair.publicKey);
  if (balance === null || balance < config.TREASURY_MIN_LAMPORTS) {
    if (balance === null) {
      logger.warn(
        `Treasury balance check failed: RPC endpoints unreachable. Batch ${batchId} will wait.`
      );
    } else {
      logger.warn(
        `Treasury balance (${balance} lamports) is below minimum threshold ${config.TREASURY_MIN_LAMPORTS} lamports. Batch ${batchId} will wait.`
      );
    }
    return { batchId, status: "skipped_treasury_low" };
  }

  // 2. Validate memo before signing (S18)
  let memoText = "";
  try {
    memoText = buildBatchMemo(batchRow.id, batchRow.events_hash);
  } catch (err: any) {
    logger.error(`Batch ${batchId} memo validation failed: ${err.message}. Moving to failed_review.`);
    markBatchFailedReview(db, batchId, `Memo validation failed: ${err.message}`);
    return { batchId, status: "failed_review", error: err.message };
  }

  // 3. Fetch fresh blockhash immediately before signing
  let blockhashInfo;
  try {
    blockhashInfo = await getFreshBlockhash(router);
  } catch (err: any) {
    logger.warn(`Could not get fresh blockhash for batch ${batchId}: ${err.message}`);
    return { batchId, status: "submitted", error: err.message };
  }

  // 4. Build and sign transaction
  let built;
  try {
    built = buildSettlementTx(
      batchRow.solana_address,
      batchRow.total_lamports,
      memoText,
      blockhashInfo,
      treasuryKeypair
    );
  } catch (err: any) {
    logger.error(`Error building settlement transaction for batch ${batchId}: ${err.message}`);
    markBatchFailedReview(db, batchId, err.message);
    return { batchId, status: "failed_review", error: err.message };
  }

  const now = Date.now();

  // 5. Store serialized_tx, signature, and last_valid_block_height in SQLite BEFORE sending (S20)
  db.prepare(`
    UPDATE batches
    SET
      state = 'submitted',
      signature = ?,
      serialized_tx = ?,
      last_valid_block_height = ?,
      attempts = attempts + 1,
      updated_at = ?
    WHERE id = ?
  `).run(
    built.signature,
    built.serializedTx,
    built.lastValidBlockHeight,
    now,
    batchId
  );

  logger.info(`Batch ${batchId} signed and persisted. Broadcasting signature: ${built.signature}`);

  // 6. Broadcast via RPC router
  const rawTx = Buffer.from(built.serializedTx, "base64");
  try {
    await router.callWithFailover(async (connection) => {
      return await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
      });
    });
  } catch (err: any) {
    logger.warn(`Initial broadcast failed for batch ${batchId}: ${err.message}. Will be handled by retry loop.`);
  }

  // 7. Check if confirmed immediately (optimistic poll)
  const check = await crossCheckSignatureStatus(router, built.signature);
  if (check.confirmed) {
    markBatchConfirmed(
      db,
      batchId,
      now,
      Boolean(check.independentCheck),
      Boolean(check.singleEndpointFallback)
    );
    return { batchId, status: "confirmed", signature: built.signature };
  }

  return { batchId, status: "submitted", signature: built.signature };
}

/**
 * Executes retry logic for an unconfirmed batch following Blueprint Section 5.4 exactly.
 */
export async function retryBatch(
  db: Database.Database,
  router: RpcRouter,
  batchId: string,
  treasuryKeypairOverride?: Keypair,
  configOverride?: Partial<Config>
): Promise<SettleBatchResult> {
  const config = { ...getConfig(), ...configOverride };
  const maxAttempts = config.MAX_ATTEMPTS;

  const batchRow = db.prepare(`
    SELECT b.*, p.solana_address
    FROM batches b
    JOIN payees p ON b.payee_id = p.id
    WHERE b.id = ?
  `).get(batchId) as any;

  if (!batchRow) {
    throw new Error(`Batch ${batchId} not found.`);
  }

  const signature = batchRow.signature;
  if (!signature) {
    throw new Error(`Batch ${batchId} has no signature recorded.`);
  }

  // Step 1 & 2: Query signature status on two different RPC endpoints
  const check = await crossCheckSignatureStatus(router, signature);
  if (check.confirmed) {
    logger.info(`Batch ${batchId} confirmed on chain. Finalizing payment.`);
    markBatchConfirmed(
      db,
      batchId,
      Date.now(),
      Boolean(check.independentCheck),
      Boolean(check.singleEndpointFallback)
    );
    return { batchId, status: "confirmed", signature };
  }

  // If MAX_ATTEMPTS reached, fail to review
  if (batchRow.attempts >= maxAttempts) {
    logger.warn(`Batch ${batchId} exceeded max attempts (${maxAttempts}). Moving to failed_review.`);
    markBatchFailedReview(db, batchId, `Exceeded max retry attempts (${maxAttempts})`);
    return { batchId, status: "failed_review", error: "max_attempts_exceeded" };
  }

  // Fetch current block height to verify expiry safely (Step 3 & 4)
  let currentBlockHeight: number | null = null;
  try {
    currentBlockHeight = await router.callWithFailover(async (connection) => {
      return await connection.getBlockHeight("confirmed");
    });
  } catch (err: any) {
    logger.warn(`Could not fetch block height during retry check: ${err.message}`);
    return { batchId, status: "retrying" };
  }

  if (currentBlockHeight === null) {
    return { batchId, status: "retrying" };
  }

  const lastValidHeight = batchRow.last_valid_block_height || 0;

  // Step 3: If current block height <= last_valid_block_height, resend identical serialized_tx
  if (currentBlockHeight <= lastValidHeight) {
    logger.info(
      `Batch ${batchRow.id} is waiting for the network. Retry ${batchRow.attempts + 1} of ${maxAttempts}.`
    );

    const now = Date.now();
    db.prepare(`
      UPDATE batches
      SET state = 'retrying', attempts = attempts + 1, updated_at = ?
      WHERE id = ?
    `).run(now, batchId);

    incrementCounter(db, "batch_retries_total");

    if (batchRow.serialized_tx) {
      const rawTx = Buffer.from(batchRow.serialized_tx, "base64");
      try {
        await router.callWithFailover(async (connection) => {
          return await connection.sendRawTransaction(rawTx, { skipPreflight: true });
        });
      } catch (err: any) {
        logger.warn(`Resend failed on retry for batch ${batchId}: ${err.message}`);
      }
    }

    return { batchId, status: "retrying", signature };
  }

  // Step 4: Current block height > last_valid_block_height. Transaction expired.
  // Rebuild with fresh blockhash, keep same batchId and eventsHash!
  logger.info(`Batch ${batchId} expired on-chain (block ${currentBlockHeight} > ${lastValidHeight}). Rebuilding with fresh blockhash.`);

  const treasuryKeypair = treasuryKeypairOverride || loadTreasuryKeypair(config.TREASURY_KEYPAIR_PATH);
  const memoText = buildBatchMemo(batchRow.id, batchRow.events_hash);

  const blockhashInfo = await getFreshBlockhash(router);
  const built = buildSettlementTx(
    batchRow.solana_address,
    batchRow.total_lamports,
    memoText,
    blockhashInfo,
    treasuryKeypair
  );

  const now = Date.now();
  db.prepare(`
    UPDATE batches
    SET
      state = 'expired_rebuilt',
      signature = ?,
      serialized_tx = ?,
      last_valid_block_height = ?,
      attempts = attempts + 1,
      updated_at = ?
    WHERE id = ?
  `).run(
    built.signature,
    built.serializedTx,
    built.lastValidBlockHeight,
    now,
    batchId
  );

  incrementCounter(db, "batches_expired_rebuilt_total");

  // Move to submitted
  db.prepare(`
    UPDATE batches
    SET state = 'submitted', updated_at = ?
    WHERE id = ?
  `).run(now, batchId);

  // Send new transaction
  const rawTx = Buffer.from(built.serializedTx, "base64");
  try {
    await router.callWithFailover(async (connection) => {
      return await connection.sendRawTransaction(rawTx, { skipPreflight: false });
    });
  } catch (err: any) {
    logger.warn(`Broadcast failed after expired_rebuilt for batch ${batchId}: ${err.message}`);
  }

  return { batchId, status: "expired_rebuilt", signature: built.signature };
}

export function markBatchConfirmed(
  db: Database.Database,
  batchId: string,
  timestamp: number,
  independentCheck: boolean = false,
  singleEndpointFallback: boolean = false
): void {
  const executeConfirmation = db.transaction(() => {
    db.prepare(`
      UPDATE batches
      SET state = 'confirmed',
          updated_at = ?,
          independent_check = ?,
          single_endpoint_fallback = ?
      WHERE id = ?
    `).run(timestamp, independentCheck ? 1 : 0, singleEndpointFallback ? 1 : 0, batchId);

    db.prepare(`
      UPDATE events
      SET state = 'paid'
      WHERE batch_id = ?
    `).run(batchId);

    incrementCounter(db, "batches_confirmed_total");

    // Standard Solana base fee (5000 lamports)
    incrementCounter(db, "fees_paid_lamports", 5000);

    // Record latency
    const batch = db.prepare("SELECT created_at FROM batches WHERE id = ?").get(batchId) as { created_at: number } | undefined;
    if (batch) {
      const latencyMs = Math.max(0, timestamp - batch.created_at);
      db.prepare(`
        INSERT INTO latency_samples (at, kind, ms)
        VALUES (?, 'confirmation', ?)
      `).run(timestamp, latencyMs);
    }
  });

  executeConfirmation();
}

function markBatchFailedReview(db: Database.Database, batchId: string, reason: string): void {
  const executeFailure = db.transaction(() => {
    db.prepare(`
      UPDATE batches
      SET state = 'failed_review', updated_at = ?
      WHERE id = ?
    `).run(Date.now(), batchId);

    db.prepare(`
      UPDATE events
      SET state = 'flagged'
      WHERE batch_id = ?
    `).run(batchId);

    writeAuditLog(db, "worker", "batch_failed_review", {
      batchId,
      reason,
    });
  });

  executeFailure();
}
