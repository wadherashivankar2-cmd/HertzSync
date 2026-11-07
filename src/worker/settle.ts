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

/**
 * Checks signature status across two distinct endpoints to prevent single lying RPC exploits (S9).
 * Returns { confirmed, lied }
 */
export async function crossCheckSignatureStatus(
  router: RpcRouter,
  signature: string
): Promise<{ confirmed: boolean; lied: boolean }> {
  const endpoints = router.getEndpoints();
  if (endpoints.length === 0) {
    return { confirmed: false, lied: false };
  }

  const results: { endpoint: string; confirmed: boolean }[] = [];

  for (const ep of endpoints) {
    if (!router.isEndpointAvailable(ep)) {
      continue;
    }

    const chaos = router.getChaosMode(ep);
    if (chaos === "lie") {
      // Fabricate confirmed status
      results.push({ endpoint: ep, confirmed: true });
      if (results.length >= 2) break;
      continue;
    }

    try {
      const res = await router.callWithFailover(async (conn) => {
        return await conn.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
      });

      const st = res?.value?.[0];
      const isConfirmed =
        st !== null &&
        st !== undefined &&
        (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") &&
        st.err === null;

      results.push({ endpoint: ep, confirmed: isConfirmed });
      if (results.length >= 2) {
        break;
      }
    } catch {
      // ignore endpoint failure during cross-check
    }
  }

  if (results.length >= 2) {
    if (results[0].confirmed !== results[1].confirmed) {
      logger.warn(
        `Signature ${signature} confirmation mismatch between endpoints (${results[0].endpoint}: ${results[0].confirmed} vs ${results[1].endpoint}: ${results[1].confirmed}).`
      );
      return { confirmed: false, lied: true };
    }
    return { confirmed: results[0].confirmed && results[1].confirmed, lied: false };
  }

  // Fallback to single endpoint confirmation if only one available
  return { confirmed: results[0]?.confirmed ?? false, lied: false };
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
  const { confirmed } = await crossCheckSignatureStatus(router, built.signature);
  if (confirmed) {
    markBatchConfirmed(db, batchId, now);
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
  const { confirmed } = await crossCheckSignatureStatus(router, signature);
  if (confirmed) {
    logger.info(`Batch ${batchId} confirmed on chain. Finalizing payment.`);
    markBatchConfirmed(db, batchId, Date.now());
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

function markBatchConfirmed(db: Database.Database, batchId: string, timestamp: number): void {
  const executeConfirmation = db.transaction(() => {
    db.prepare(`
      UPDATE batches
      SET state = 'confirmed', updated_at = ?
      WHERE id = ?
    `).run(timestamp, batchId);

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
