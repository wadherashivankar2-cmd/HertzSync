import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  SignatureStatus,
} from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import { RpcRouter } from "./rpc-router";
import { MEMO_MAX_BYTES } from "./ids";
import { getConfig } from "./config";
import { logger } from "./logger";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export interface BlockhashInfo {
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface BuiltSettlementTx {
  transaction: Transaction;
  serializedTx: string; // base64 string
  signature: string;    // base58 signature
  lastValidBlockHeight: number;
}

/**
 * Solana blockhash validity window:
 * A recent blockhash is valid for 151 slots on the Solana cluster (~60-90 seconds assuming ~400ms target slot time).
 * Once the cluster advances beyond the associated `lastValidBlockHeight`, transactions signed
 * with this blockhash expire and cannot be committed by validators, preventing replays.
 * Reference: https://docs.anza.xyz/consensus/commitment and https://solana.com/docs/core/transactions#recent-blockhash
 *
 * Rule: ALWAYS query the network fresh immediately before signing; NEVER cache across batches or retry loops.
 */
export async function getFreshBlockhash(router: RpcRouter): Promise<BlockhashInfo> {
  const result = await router.callWithFailover(async (connection) => {
    return await connection.getLatestBlockhash("confirmed");
  });

  if (!result) {
    throw new Error("Failed to retrieve fresh blockhash from Solana RPC router (all endpoints unavailable).");
  }

  return {
    blockhash: result.blockhash,
    lastValidBlockHeight: result.lastValidBlockHeight,
  };
}

/**
 * Builds and signs a settlement transaction containing:
 * 1. SystemProgram transfer to payeeAddress for specified lamports.
 * 2. SPL Memo instruction with the text `trickle:v1:<batchId>:<eventsHash>`.
 *
 * Enforces MEMO_MAX_BYTES (120) limit before signing.
 * Returns the signed transaction, base64-serialized transaction string, and base58 signature.
 */
export function buildSettlementTx(
  payeeAddress: string,
  lamports: number,
  memoText: string,
  blockhashInfo: BlockhashInfo,
  treasuryKeypair: Keypair
): BuiltSettlementTx {
  let payeePubkey: PublicKey;
  try {
    payeePubkey = new PublicKey(payeeAddress);
  } catch (err: any) {
    throw new Error(`Invalid payee Solana address "${payeeAddress}": ${err.message}`);
  }

  const memoBytes = Buffer.byteLength(memoText, "utf8");
  if (memoBytes > MEMO_MAX_BYTES) {
    throw new Error(
      `Memo byte length ${memoBytes} exceeds maximum permitted ${MEMO_MAX_BYTES} bytes: "${memoText}"`
    );
  }

  const tx = new Transaction({
    recentBlockhash: blockhashInfo.blockhash,
    feePayer: treasuryKeypair.publicKey,
  });

  // Transfer instruction
  tx.add(
    SystemProgram.transfer({
      fromPubkey: treasuryKeypair.publicKey,
      toPubkey: payeePubkey,
      lamports,
    })
  );

  // Memo instruction
  tx.add(
    new TransactionInstruction({
      keys: [{ pubkey: treasuryKeypair.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoText, "utf8"),
    })
  );

  tx.sign(treasuryKeypair);

  if (!tx.signature) {
    throw new Error("Transaction signing failed: signature is missing after tx.sign().");
  }

  const serializedTx = tx.serialize().toString("base64");
  const signature = bs58.encode(tx.signature);

  return {
    transaction: tx,
    serializedTx,
    signature,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
  };
}

/**
 * Checks signature statuses across RPC endpoints using the router.
 */
export async function checkSignatureStatuses(
  router: RpcRouter,
  signatures: string[]
): Promise<(SignatureStatus | null)[]> {
  const result = await router.callWithFailover(async (connection) => {
    const res = await connection.getSignatureStatuses(signatures, {
      searchTransactionHistory: true,
    });
    return res.value;
  });

  return result || signatures.map(() => null);
}

/**
 * Safely fetches the account balance in lamports without crashing on RPC failures.
 * Returns null if network is unreachable or all endpoints are open.
 */
export async function getBalanceSafe(
  router: RpcRouter,
  address: string | PublicKey
): Promise<number | null> {
  const pubkey = typeof address === "string" ? new PublicKey(address) : address;
  const balance = await router.callWithFailover(async (connection) => {
    return await connection.getBalance(pubkey, "confirmed");
  });

  return balance;
}

/**
 * Loads the treasury keypair from the configured or specified JSON file path.
 * Security: NEVER prints or logs private key bytes.
 */
export function loadTreasuryKeypair(customPath?: string): Keypair {
  const config = getConfig();
  const keyPath = path.resolve(process.cwd(), customPath || config.TREASURY_KEYPAIR_PATH);

  if (!fs.existsSync(keyPath)) {
    throw new Error(`Treasury keypair file not found at ${keyPath}. Run "npx tsx scripts/keygen.ts" first.`);
  }

  const fileData = fs.readFileSync(keyPath, "utf8");
  const parsed = JSON.parse(fileData);

  if (!Array.isArray(parsed) || (parsed.length !== 64 && parsed.length !== 32)) {
    throw new Error(`Invalid treasury keypair format in ${keyPath}. Expected 64-byte array.`);
  }

  const secretKey = Uint8Array.from(parsed);
  return Keypair.fromSecretKey(secretKey);
}

