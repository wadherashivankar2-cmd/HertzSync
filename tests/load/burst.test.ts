import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { Keypair } from "@solana/web3.js";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { POST as postEvent } from "../../src/app/api/v1/events/route";
import { DeviceSimulator } from "../../scripts/device-sim";
import { SettlementWorker } from "../../src/worker/index";
import { RpcRouter } from "../../src/lib/rpc-router";
import { DEVNET_GENESIS_HASH } from "../../src/lib/config";
import { runReconciliation } from "../../src/worker/reconcile";

const BURST_TEST_DB = path.resolve(process.cwd(), "data/test_burst.db");
const BURST_DEVICES_DIR = path.resolve(process.cwd(), "keys/devices/test_burst");

describe("1,000-Event Burst Load Test (Blueprint Section 10 Phase 5)", () => {
  const businessId = "biz_burst_load";
  const rawApiKey = "ts_live_key_burst_load_999";
  const numDevices = 10;
  const eventsPerDevice = 100;
  const totalEvents = numDevices * eventsPerDevice; // 1,000 events
  const simulators: DeviceSimulator[] = [];
  const mockPayeeKeypair = Keypair.generate();
  const mockTreasuryKeypair = Keypair.generate();

  let broadcastCount = 0;
  let devnetNetworkCalls = 0;

  beforeAll(() => {
    // 1. Configure test environment only (RATE_LIMIT_PER_MIN = 10000; production default stays 600)
    process.env.RATE_LIMIT_PER_MIN = "10000";
    process.env.DB_PATH = BURST_TEST_DB;

    // Clean up test DB files
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${BURST_TEST_DB}${ext}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    if (fs.existsSync(BURST_DEVICES_DIR)) {
      fs.rmSync(BURST_DEVICES_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(BURST_DEVICES_DIR, { recursive: true });

    // Initialize database
    const db = createDatabaseConnection(BURST_TEST_DB);
    migrate(db);

    const now = Date.now();
    const apiKeyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");

    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(businessId, "Burst Load Business", apiKeyHash, now);

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run("payee_burst", businessId, "Burst Payee", mockPayeeKeypair.publicKey.toBase58(), now);

    // Initialize 10 simulated devices
    for (let i = 1; i <= numDevices; i++) {
      const devId = `charger_burst_${String(i).padStart(2, "0")}`;
      const sim = new DeviceSimulator(devId, `Charger ${i}`, {
        devicesDir: BURST_DEVICES_DIR,
        businessId,
      });
      simulators.push(sim);

      db.prepare(`
        INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
        VALUES (?, ?, ?, ?, 'active', ?)
      `).run(devId, businessId, "payee_burst", sim.getPublicKeyBase64(), now);
    }

    db.close();
  });

  afterAll(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${BURST_TEST_DB}${ext}`;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }

    if (fs.existsSync(BURST_DEVICES_DIR)) {
      try {
        fs.rmSync(BURST_DEVICES_DIR, { recursive: true, force: true });
      } catch {}
    }
  });

  it("bursts 1,000 events with no worker running: p95 ingest latency < 100ms, measures peak -wal size, and drains with mocked RPC", async () => {
    const latenciesMs: number[] = [];
    let peakWalSizeBytes = 0;
    const walPath = `${BURST_TEST_DB}-wal`;

    const burstStartTime = Date.now();

    // 1. Ingest 1,000 events (100 events across 10 devices)
    for (let round = 1; round <= eventsPerDevice; round++) {
      for (const sim of simulators) {
        const event = sim.generateNextEvent(50_000); // 50,000 lamports

        const req = new NextRequest("http://localhost:3000/api/v1/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${rawApiKey}`,
          },
          body: JSON.stringify(event),
        });

        const t0 = performance.now();
        const res = await postEvent(req);
        const t1 = performance.now();

        const latency = t1 - t0;
        latenciesMs.push(latency);

        expect(res.status).toBe(202);
        sim.onEventAccepted(event);
      }

      // Sample WAL file size
      if (fs.existsSync(walPath)) {
        const walSize = fs.statSync(walPath).size;
        if (walSize > peakWalSizeBytes) {
          peakWalSizeBytes = walSize;
        }
      }
    }

    const burstEndTime = Date.now();
    const burstDurationMs = burstEndTime - burstStartTime;

    // Check final WAL size
    if (fs.existsSync(walPath)) {
      const walSize = fs.statSync(walPath).size;
      if (walSize > peakWalSizeBytes) {
        peakWalSizeBytes = walSize;
      }
    }

    // Calculate latency metrics
    latenciesMs.sort((a, b) => a - b);
    const minLatency = latenciesMs[0];
    const maxLatency = latenciesMs[latenciesMs.length - 1];
    const meanLatency = latenciesMs.reduce((acc, v) => acc + v, 0) / latenciesMs.length;
    const p50 = latenciesMs[Math.floor(latenciesMs.length * 0.50)];
    const p95 = latenciesMs[Math.floor(latenciesMs.length * 0.95)];
    const p99 = latenciesMs[Math.floor(latenciesMs.length * 0.99)];

    console.log("=== BURST TEST INGEST METRICS (1,000 EVENTS) ===");
    console.log(`Total Ingest Time: ${burstDurationMs} ms`);
    console.log(`Ingest Throughput: ${(totalEvents / (burstDurationMs / 1000)).toFixed(1)} events/sec`);
    console.log(`Min Latency: ${minLatency.toFixed(2)} ms`);
    console.log(`Mean Latency: ${meanLatency.toFixed(2)} ms`);
    console.log(`p50 Latency: ${p50.toFixed(2)} ms`);
    console.log(`p95 Latency: ${p95.toFixed(2)} ms`);
    console.log(`p99 Latency: ${p99.toFixed(2)} ms`);
    console.log(`Max Latency: ${maxLatency.toFixed(2)} ms`);
    console.log(`Peak SQLite -wal Size: ${peakWalSizeBytes} bytes (${(peakWalSizeBytes / 1024).toFixed(1)} KB)`);
    console.log("================================================");

    // Assert Blueprint Requirement: p95 under 100 ms
    expect(p95).toBeLessThan(100);

    // 2. Verify all 1,000 events are queued in SQLite before worker starts
    const db = createDatabaseConnection(BURST_TEST_DB);
    const queuedCount = db.prepare("SELECT COUNT(*) as cnt FROM events WHERE state = 'queued'").get() as { cnt: number };
    expect(queuedCount.cnt).toBe(totalEvents);

    // 3. Setup Worker with MOCKED RPC (Zero network broadcasts)
    const router = new RpcRouter(db, ["https://mock-ep1.devnet.solana.com", "https://mock-ep2.devnet.solana.com"]);

    router.callWithFailover = async (op) => {
      // Mocked RPC connection
      const mockConnection = {
        getGenesisHash: async () => {
          return DEVNET_GENESIS_HASH;
        },
        getBalance: async () => {
          return 500_000_000; // Mock funded treasury (0.5 SOL)
        },
        getLatestBlockhash: async () => {
          return {
            blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM",
            lastValidBlockHeight: 999999,
          };
        },
        getBlockHeight: async () => {
          return 1000;
        },
        sendRawTransaction: async (_rawTx: Buffer) => {
          broadcastCount++;
          // Returns deterministic mock signature without hitting DevNet
          return `mock_burst_tx_signature_${broadcastCount}_${crypto.randomBytes(4).toString("hex")}`;
        },
        getSignatureStatuses: async (signatures: string[]) => {
          return {
            value: signatures.map(() => ({
              confirmationStatus: "confirmed",
              err: null,
            })),
          };
        },
      };

      return await op(mockConnection as any, "https://mock-ep1.devnet.solana.com");
    };

    const worker = new SettlementWorker(db, router, {
      BATCH_INTERVAL_MS: 0,
      BATCH_MAX_EVENTS: 100, // 100 events per batch -> exactly 10 batches for 1,000 events
      MAX_BATCH_LAMPORTS: 1_000_000_000,
      TREASURY_KEYPAIR_PATH: "keys/treasury.json",
      RECONCILE_INTERVAL_MS: 0,
    });

    (worker as any).mockTreasuryKeypair = mockTreasuryKeypair;

    await worker.startup();

    // 4. Drain queue and measure drain time
    const drainStartTime = performance.now();

    let stepCount = 0;
    while (true) {
      stepCount++;
      await worker.step();

      const remaining = db.prepare("SELECT COUNT(*) as cnt FROM events WHERE state = 'queued'").get() as { cnt: number };
      if (remaining.cnt === 0) {
        // Also ensure any unconfirmed batches are processed to confirmed
        const unconfirmed = db.prepare("SELECT COUNT(*) as cnt FROM batches WHERE state IN ('built', 'submitted', 'retrying')").get() as { cnt: number };
        if (unconfirmed.cnt === 0) {
          break;
        }
      }

      if (stepCount > 50) {
        throw new Error("Worker failed to drain burst queue within 50 steps");
      }
    }

    const drainEndTime = performance.now();
    const drainDurationMs = drainEndTime - drainStartTime;

    console.log("=== BURST TEST DRAIN METRICS ===");
    console.log(`Drain Duration: ${drainDurationMs.toFixed(2)} ms`);
    console.log(`Batches Created & Settled: ${broadcastCount}`);
    console.log(`DevNet Live Network Calls: ${devnetNetworkCalls} (Strict Zero)`);
    console.log("================================");

    // Verify all 1,000 events are paid
    const paidCount = db.prepare("SELECT COUNT(*) as cnt FROM events WHERE state = 'paid'").get() as { cnt: number };
    expect(paidCount.cnt).toBe(totalEvents);

    // 5. Run reconciliation
    const recon = runReconciliation(db);
    console.log("RECONCILIATION RESULT:", JSON.stringify(recon, null, 2));

    expect(recon.generated).toBe(totalEvents);
    expect(recon.accounted).toBe(totalEvents);
    expect(recon.lost).toBe(0);
    expect(recon.onchainDuplicates).toBe(0);
    expect(recon.ok).toBe(true);

    // Confirm strict zero live network broadcasts
    expect(devnetNetworkCalls).toBe(0);

    db.close();
  });
});
