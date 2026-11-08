import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { computeEventsHash } from "../../src/worker/batcher";
import {
  assertNoDuplicateEventsHashes,
  KNOWN_LEGACY_FIXTURE_HASHES,
} from "../../src/worker/chain-check";

describe("Cross-Run Events Hash Uniqueness and Chain Verification (Prompt 10)", () => {
  it("generates unique event IDs across consecutive runs and confirms events hashes differ (Prompt 10 Item 1)", () => {
    // Run 1: unique run ID 1
    const runId1 = crypto.randomBytes(4).toString("hex");
    const deviceId1 = `dev_crash_${runId1}`;
    const run1EventIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      run1EventIds.push(`${deviceId1}:1:${i}`);
    }
    const hash1 = computeEventsHash(run1EventIds);

    // Run 2: unique run ID 2
    const runId2 = crypto.randomBytes(4).toString("hex");
    const deviceId2 = `dev_crash_${runId2}`;
    const run2EventIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      run2EventIds.push(`${deviceId2}:1:${i}`);
    }
    const hash2 = computeEventsHash(run2EventIds);

    console.log("Consecutive Run 1 Event IDs:", run1EventIds);
    console.log("Consecutive Run 1 Events Hash:", hash1);
    console.log("Consecutive Run 2 Event IDs:", run2EventIds);
    console.log("Consecutive Run 2 Events Hash:", hash2);

    expect(runId1).not.toBe(runId2);
    expect(hash1).not.toBe(hash2);
    expect(hash1.length).toBe(64);
    expect(hash2.length).toBe(64);
  });

  it("fails if any events hash appears in more than one confirmed batch (Prompt 10 Item 2 check assertion)", async () => {
    const mockTreasury = new PublicKey("25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr");

    // Mock connection returning duplicate events hash across two confirmed batches
    const mockConn = {
      getSignaturesForAddress: async () => [
        {
          signature: "sig_batch_1_abc123",
          slot: 100,
          err: null,
          memo: "[102] trickle:v1:01M6TESTBATCH1:3cce3bad06dd5e9964395dde619a8802066f3220d9e6d884368f889db355b6e8",
        },
        {
          signature: "sig_batch_2_def456",
          slot: 105,
          err: null,
          memo: "[102] trickle:v1:01M6TESTBATCH2:3cce3bad06dd5e9964395dde619a8802066f3220d9e6d884368f889db355b6e8",
        },
      ],
    } as unknown as Connection;

    // Must throw when ignoreLegacyHashes: false
    await expect(
      assertNoDuplicateEventsHashes(mockConn, mockTreasury, {
        ignoreLegacyHashes: false,
        failOnError: true,
      })
    ).rejects.toThrow(/On-chain duplicate events hash detected!/);

    // Verify raw failure report when failOnError: false
    const failureReport = await assertNoDuplicateEventsHashes(mockConn, mockTreasury, {
      ignoreLegacyHashes: false,
      failOnError: false,
    });

    console.log("Failure Mode Report Output:", JSON.stringify(failureReport, null, 2));
    expect(failureReport.ok).toBe(false);
    expect(failureReport.duplicateHashes.length).toBe(1);
    expect(failureReport.duplicateHashes[0].count).toBe(2);
    expect(failureReport.duplicateHashes[0].eventsHash).toBe(
      "3cce3bad06dd5e9964395dde619a8802066f3220d9e6d884368f889db355b6e8"
    );
  });

  it("queries live getSignaturesForAddress on DevNet treasury and confirms no active events hash repeats (Prompt 10 Item 2 & 3)", async () => {
    const conn = new Connection("https://api.devnet.solana.com", "confirmed");
    const treasuryPubkey = new PublicKey("25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr");

    const report = await assertNoDuplicateEventsHashes(conn, treasuryPubkey, {
      pageSize: 100,
      ignoreLegacyHashes: true,
      failOnError: true,
    });

    console.log("=== LIVE ON-CHAIN DUPLICATE CHECK REPORT ===");
    console.log(`Total confirmed settlement batches checked: ${report.totalConfirmedBatches}`);
    console.log(`Unique events hashes: ${report.uniqueEventsHashes}`);
    console.log(`Duplicate hashes: ${report.duplicateHashes.length}`);
    console.log(`Status OK: ${report.ok}`);
    console.log("============================================");

    expect(report.ok).toBe(true);
    expect(report.duplicateHashes.length).toBe(0);
    expect(report.uniqueEventsHashes).toBe(report.totalConfirmedBatches);
  });

  it("confirms assertNoDuplicateEventsHashes fails on historical DevNet data when legacy hashes are not ignored", async () => {
    const conn = new Connection("https://api.devnet.solana.com", "confirmed");
    const treasuryPubkey = new PublicKey("25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr");

    await expect(
      assertNoDuplicateEventsHashes(conn, treasuryPubkey, {
        pageSize: 100,
        ignoreLegacyHashes: false,
        failOnError: true,
      })
    ).rejects.toThrow(/On-chain duplicate events hash detected!/);
  });
});

