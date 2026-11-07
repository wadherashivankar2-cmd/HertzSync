import crypto from "crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { Keypair } from "@solana/web3.js";
import { RpcRouter } from "../../src/lib/rpc-router";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import {
  getFreshBlockhash,
  buildSettlementTx,
  getBalanceSafe,
  loadTreasuryKeypair,
} from "../../src/lib/solana";
import { getConfig, DEVNET_GENESIS_HASH } from "../../src/lib/config";
import { generateOrLoadTreasuryKey } from "../../scripts/keygen";
import { generateUlid, buildBatchMemo } from "../../src/lib/ids";

describe("Solana DevNet Integration and Guardrails (Phase 3)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let router: RpcRouter;

  beforeAll(() => {
    db = createDatabaseConnection(":memory:");
    migrate(db);
    router = new RpcRouter(db);
  });

  it("verifies cluster genesis hash matches official DevNet genesis hash", async () => {
    // Startup check: getGenesisHash must equal DEVNET_GENESIS_HASH
    await expect(router.verifyDevnetCluster()).resolves.not.toThrow();
  });

  it("refuses to run if cluster genesis hash does not match DevNet (Mainnet accidental connection guard S4)", async () => {
    // Mock router with an endpoint returning a mainnet-like hash
    const mockRouter = new RpcRouter(db, ["https://mock-mainnet.solana.com"]);
    // Force mock call to return an unexpected genesis hash
    mockRouter.callWithFailover = async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" as any;

    await expect(mockRouter.verifyDevnetCluster()).rejects.toThrow(
      /FATAL: Cluster genesis hash mismatch/
    );
  });

  it("fetches a fresh blockhash with non-empty blockhash and positive lastValidBlockHeight", async () => {
    const blockhashInfo = await getFreshBlockhash(router);
    expect(blockhashInfo.blockhash).toBeDefined();
    expect(blockhashInfo.blockhash.length).toBeGreaterThan(30);
    expect(blockhashInfo.lastValidBlockHeight).toBeGreaterThan(0);
  });

  it("sends real DevNet transfer with memo if treasury is funded, or skips safely if below TREASURY_MIN_LAMPORTS", async () => {
    const config = getConfig();
    const treasuryKey = generateOrLoadTreasuryKey(config.TREASURY_KEYPAIR_PATH);
    const balance = await getBalanceSafe(router, treasuryKey.publicKey);

    if (balance === null || balance < config.TREASURY_MIN_LAMPORTS) {
      console.log(
        `[DevNet Test Notice]: Skipping live DevNet transfer test. ` +
        `Treasury balance (${balance ?? 0} lamports) is below threshold TREASURY_MIN_LAMPORTS (${config.TREASURY_MIN_LAMPORTS} lamports). ` +
        `Treasury address: ${treasuryKey.publicKey.toBase58()}. ` +
        `Fund via official faucet: "solana airdrop 1 ${treasuryKey.publicKey.toBase58()} --url devnet" or https://faucet.solana.com`
      );
      // Pass suite cleanly without throwing funding error
      expect(true).toBe(true);
      return;
    }

    // Enforce run cap per test process execution (Blueprint & Phase 4 rule, capped in .env.example)
    const maxTransfers = parseInt(process.env.MAX_LIVE_TRANSFERS_PER_TEST_RUN || "1", 10);
    if (maxTransfers === 0) {
      console.log(
        `[DevNet Test Notice]: Skipping live DevNet transfer test. ` +
        `MAX_LIVE_TRANSFERS_PER_TEST_RUN is set to 0.`
      );
      expect(true).toBe(true);
      return;
    }
    const currentCount = (globalThis as any).__liveDevnetTransferCount ?? 0;
    if (currentCount >= maxTransfers) {
      console.log(
        `[DevNet Test Notice]: Skipping live DevNet transfer test. ` +
        `Cap reached (${currentCount}/${maxTransfers} from MAX_LIVE_TRANSFERS_PER_TEST_RUN).`
      );
      expect(true).toBe(true);
      return;
    }
    (globalThis as any).__liveDevnetTransferCount = currentCount + 1;

    // Single documented recipient: treasury itself (cycles principal safely, net cost is only 5,000 lamport tx fee)
    const payee = treasuryKey.publicKey.toBase58();
    // Must be at or above rent exemption minimum for a new system account (890,880 lamports)
    const lamportsToSend = 1_000_000; // 0.001 SOL
    const runId = crypto.randomBytes(4).toString("hex");
    const batchId = generateUlid();
    const eventsHash = crypto.createHash("sha256").update(`devnet_transfer_${runId}`).digest("hex");
    const memoText = buildBatchMemo(batchId, eventsHash);

    const blockhashInfo = await getFreshBlockhash(router);
    const built = buildSettlementTx(
      payee,
      lamportsToSend,
      memoText,
      blockhashInfo,
      treasuryKey
    );

    expect(built.signature).toBeDefined();
    expect(built.serializedTx).toBeDefined();

    const rawTx = Buffer.from(built.serializedTx, "base64");
    const sendResult = await router.callWithFailover(async (connection) => {
      return await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
      });
    });

    expect(sendResult).toBe(built.signature);

    const confirmResult = await router.callWithFailover(async (connection) => {
      return await connection.confirmTransaction(
        {
          signature: built.signature,
          blockhash: blockhashInfo.blockhash,
          lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
        },
        "confirmed"
      );
    });

    expect(confirmResult?.value.err).toBeNull();
    console.log(`Live DevNet Settlement Signature: ${built.signature}`);
    console.log(`Explorer Link: https://explorer.solana.com/tx/${built.signature}?cluster=devnet`);
  });
});

