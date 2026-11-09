import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { Keypair } from "@solana/web3.js";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { RpcRouter } from "../../src/lib/rpc-router";
import { retryBatch } from "../../src/worker/settle";
import { GET as getMetrics } from "../../src/app/api/v1/metrics/route";
import { GET as getBatches } from "../../src/app/api/v1/batches/route";
import { GET as getReconciliation } from "../../src/app/api/v1/reconciliation/route";
import { POST as postChaos } from "../../src/app/api/v1/chaos/route";
import { incrementCounter } from "../../src/lib/counters";

const DASHBOARD_TEST_DB = path.resolve(process.cwd(), "data/test_dashboard.db");

describe("Dashboard APIs Integration (Blueprint Section 9 & Phase 6)", () => {
  beforeAll(() => {
    process.env.DB_PATH = DASHBOARD_TEST_DB;
    process.env.CHAOS_ENABLED = "true";
    process.env.ADMIN_API_KEY = "test_admin_key_123";

    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${DASHBOARD_TEST_DB}${ext}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    const db = createDatabaseConnection(DASHBOARD_TEST_DB);
    migrate(db);

    const now = Date.now();

    // 1. Seed business & payee
    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_dash', 'Dashboard Biz', 'hash_dash', ?)
    `).run(now);

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_dash', 'biz_dash', 'Charger Site Alpha', '25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr', ?)
    `).run(now);

    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES ('dev_01', 'biz_dash', 'payee_dash', 'mock_pubkey_base64', 'active', ?)
    `).run(now);

    // 2. Seed events in various states
    db.prepare(`
      INSERT INTO events (id, business_id, device_id, epoch, seq, amount_lamports, occurred_at, received_at, payload_hash, signature, state)
      VALUES ('dev_01:1:1', 'biz_dash', 'dev_01', 1, 1, 50000, ?, ?, 'h1', 's1', 'queued')
    `).run(now, now);

    db.prepare(`
      INSERT INTO events (id, business_id, device_id, epoch, seq, amount_lamports, occurred_at, received_at, payload_hash, signature, state)
      VALUES ('dev_01:1:2', 'biz_dash', 'dev_01', 1, 2, 50000, ?, ?, 'h2', 's2', 'paid')
    `).run(now, now);

    incrementCounter(db, "events_received_total", 2);
    incrementCounter(db, "generated_by_ingest", 2);

    // 3. Seed batch
    db.prepare(`
      INSERT INTO batches (id, payee_id, total_lamports, event_count, events_hash, state, signature, attempts, created_at, updated_at)
      VALUES ('01M6VDASHBOARDTEST00000000', 'payee_dash', 50000, 1, 'mock_hash', 'confirmed', 'mock_solana_signature_xyz', 1, ?, ?)
    `).run(now, now);

    // 4. Seed reconciliation
    db.prepare(`
      INSERT INTO reconciliations (id, run_at, generated, queued, batched, paid, flagged, lost, onchain_duplicates, ok)
      VALUES ('recon_01', ?, 2, 1, 0, 1, 0, 0, 0, 1)
    `).run(now);

    // 5. Seed audit log
    db.prepare(`
      INSERT INTO audit_log (at, actor, action, detail)
      VALUES (?, 'api', 'new_epoch_registered', '{"deviceId":"dev_01","epoch":1}')
    `).run(now);

    db.close();
  });

  afterAll(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${DASHBOARD_TEST_DB}${ext}`;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
  });

  it("GET /api/v1/metrics returns complete metrics, endpoint states, and audit log from SQLite only", async () => {
    const res = await getMetrics();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.metrics).toBeDefined();
    expect(body.metrics.events_received_total).toBeGreaterThanOrEqual(2);
    expect(body.metrics.events_queued).toBe(1);
    expect(body.metrics.events_paid).toBe(1);
    expect(body.metrics.events_lost).toBe(0);
    expect(body.metrics.onchain_duplicates).toBe(0);
    expect(body.metrics.batches_confirmed_total).toBe(1);

    expect(body.rpc_endpoints).toBeDefined();
    expect(Array.isArray(body.rpc_endpoints)).toBe(true);

    expect(body.recent_audit_logs).toBeDefined();
    expect(body.recent_audit_logs.length).toBeGreaterThanOrEqual(1);
    expect(body.recent_audit_logs[0].action).toBe("new_epoch_registered");
  });

  it("GET /api/v1/batches returns batches with payee labels and explorer URLs", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/batches?limit=10");
    const res = await getBatches(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.batches).toBeDefined();
    expect(body.batches.length).toBeGreaterThanOrEqual(1);

    const batch = body.batches[0];
    expect(batch.id).toBe("01M6VDASHBOARDTEST00000000");
    expect(batch.payeeLabel).toBe("Charger Site Alpha");
    expect(batch.state).toBe("confirmed");
    expect(batch.explorerUrl).toContain("https://explorer.solana.com/tx/mock_solana_signature_xyz?cluster=devnet");
  });

  it("GET /api/v1/reconciliation returns latest conservation report", async () => {
    const res = await getReconciliation();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.reconciliation).toBeDefined();
    expect(body.reconciliation.ok).toBe(1);
    expect(body.reconciliation.generated).toBe(2);
    expect(body.reconciliation.lost).toBe(0);
    expect(body.reconciliation.onchainDuplicates).toBe(0);
  });

  it("POST /api/v1/chaos alters system_state which is immediately reflected in GET /api/v1/metrics", async () => {
    const targetEndpoint = "https://api.devnet.solana.com";

    // 1. Simulate outage
    const chaosReq = new NextRequest("http://localhost:3000/api/v1/chaos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test_admin_key_123",
      },
      body: JSON.stringify({
        endpoint: targetEndpoint,
        mode: "down",
      }),
    });

    const chaosRes = await postChaos(chaosReq);
    expect(chaosRes.status).toBe(200);

    // 2. Metrics endpoint immediately reflects down status
    const metricsRes = await getMetrics();
    const metricsBody = await metricsRes.json();
    const ep = metricsBody.rpc_endpoints.find((e: any) => e.url === targetEndpoint);
    expect(ep).toBeDefined();
    expect(ep.state).toBe("down");
    expect(ep.chaosMode).toBe("down");

    // 3. Restore network
    const restoreReq = new NextRequest("http://localhost:3000/api/v1/chaos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test_admin_key_123",
      },
      body: JSON.stringify({
        endpoint: targetEndpoint,
        mode: "off",
      }),
    });

    const restoreRes = await postChaos(restoreReq);
    expect(restoreRes.status).toBe(200);

    const restoredMetricsRes = await getMetrics();
    const restoredBody = await restoredMetricsRes.json();
    const restoredEp = restoredBody.rpc_endpoints.find((e: any) => e.url === targetEndpoint);
    expect(restoredEp.state).toBe("closed");
    expect(["off", "none"]).toContain(restoredEp.chaosMode);
  });

  it("stores single_endpoint_fallback = 1 and independent_check = 0 for single fallback, and independent_check = 1 for two-endpoint confirmation", async () => {
    const db = createDatabaseConnection(DASHBOARD_TEST_DB);
    const mockKeypair = Keypair.generate();
    const now = Date.now();

    // 1. Seed events and batches for both scenarios
    db.prepare(`
      INSERT INTO events (id, business_id, device_id, epoch, seq, amount_lamports, occurred_at, received_at, payload_hash, signature, state, batch_id)
      VALUES ('dev_01:1:101', 'biz_dash', 'dev_01', 1, 101, 10000, ?, ?, 'h_fb', 'sig_fb', 'batched', 'batch_fallback_01')
    `).run(now, now);

    db.prepare(`
      INSERT INTO batches (id, payee_id, total_lamports, event_count, events_hash, state, signature, serialized_tx, last_valid_block_height, attempts, created_at, updated_at)
      VALUES ('batch_fallback_01', 'payee_dash', 10000, 1, 'hash_fb', 'submitted', 'sig_fb_tx', 'raw_tx_fb', 500, 1, ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO events (id, business_id, device_id, epoch, seq, amount_lamports, occurred_at, received_at, payload_hash, signature, state, batch_id)
      VALUES ('dev_01:1:102', 'biz_dash', 'dev_01', 1, 102, 20000, ?, ?, 'h_q', 'sig_q', 'batched', 'batch_quorum_01')
    `).run(now, now);

    db.prepare(`
      INSERT INTO batches (id, payee_id, total_lamports, event_count, events_hash, state, signature, serialized_tx, last_valid_block_height, attempts, created_at, updated_at)
      VALUES ('batch_quorum_01', 'payee_dash', 20000, 1, 'hash_q', 'submitted', 'sig_q_tx', 'raw_tx_q', 500, 1, ?, ?)
    `).run(now, now);

    // 2. Settle batch 1 with single-endpoint router (single_endpoint_fallback = 1, independent_check = 0)
    const singleRouter = new RpcRouter(db, ["https://api.devnet.solana.com"]);
    singleRouter.callWithFailover = async (op) => {
      return op({
        getSignatureStatuses: async () => ({
          value: [{ confirmationStatus: "confirmed", err: null }],
        }),
      } as any, "https://api.devnet.solana.com");
    };

    const res1 = await retryBatch(db, singleRouter, "batch_fallback_01", mockKeypair);
    expect(res1.status).toBe("confirmed");

    const batchFallback = db.prepare("SELECT state, independent_check, single_endpoint_fallback FROM batches WHERE id = 'batch_fallback_01'").get() as any;
    expect(batchFallback.state).toBe("confirmed");
    expect(batchFallback.single_endpoint_fallback).toBe(1);
    expect(batchFallback.independent_check).toBe(0);

    // 3. Settle batch 2 with dual-endpoint router (independent_check = 1, single_endpoint_fallback = 0)
    const ep1 = "https://mock-ep-1.devnet.solana.com";
    const ep2 = "https://mock-ep-2.devnet.solana.com";
    const dualRouter = new RpcRouter(db, [ep1, ep2]);
    dualRouter.callEndpoint = async (endpoint: string, op: any) => {
      return op({
        getSignatureStatuses: async () => ({
          value: [{ confirmationStatus: "confirmed", err: null }],
        }),
      }, endpoint);
    };

    const res2 = await retryBatch(db, dualRouter, "batch_quorum_01", mockKeypair);
    expect(res2.status).toBe("confirmed");

    const batchQuorum = db.prepare("SELECT state, independent_check, single_endpoint_fallback FROM batches WHERE id = 'batch_quorum_01'").get() as any;
    expect(batchQuorum.state).toBe("confirmed");
    expect(batchQuorum.single_endpoint_fallback).toBe(0);
    expect(batchQuorum.independent_check).toBe(1);

    // 4. Verify GET /api/v1/batches exposes these fields
    const req = new NextRequest("http://localhost:3000/api/v1/batches?limit=10");
    const apiRes = await getBatches(req);
    expect(apiRes.status).toBe(200);

    const apiBody = await apiRes.json();
    const bFallback = apiBody.batches.find((b: any) => b.id === "batch_fallback_01");
    expect(bFallback).toBeDefined();
    expect(bFallback.singleEndpointFallback).toBe(true);
    expect(bFallback.independentCheck).toBe(false);

    const bQuorum = apiBody.batches.find((b: any) => b.id === "batch_quorum_01");
    expect(bQuorum).toBeDefined();
    expect(bQuorum.singleEndpointFallback).toBe(false);
    expect(bQuorum.independentCheck).toBe(true);

    db.close();
  });

  it("returns verificationStatus 'pending' for non-confirmed batches and 'legacy' for confirmed batches with check_recorded 0", async () => {
    const db = createDatabaseConnection(DASHBOARD_TEST_DB);
    const now = Date.now();

    // Insert a batch in state "submitted" with check_recorded 0
    db.prepare(`
      INSERT INTO batches (id, payee_id, total_lamports, event_count, events_hash, state, signature, serialized_tx, last_valid_block_height, attempts, check_recorded, created_at, updated_at)
      VALUES ('batch_submitted_pending_01', 'payee_dash', 15000, 1, 'hash_pend', 'submitted', 'sig_pend_tx', 'raw_tx_pend', 500, 1, 0, ?, ?)
    `).run(now, now);

    const req = new NextRequest("http://localhost:3000/api/v1/batches?limit=10");
    const apiRes = await getBatches(req);
    expect(apiRes.status).toBe(200);

    const apiBody = await apiRes.json();

    // Confirm the submitted batch returns verificationStatus "pending"
    const bSubmitted = apiBody.batches.find((b: any) => b.id === "batch_submitted_pending_01");
    expect(bSubmitted).toBeDefined();
    expect(bSubmitted.verificationStatus).toBe("pending");
    expect(bSubmitted.checkRecorded).toBe(false);

    // Confirm an existing confirmed batch with check_recorded 0 returns "legacy"
    const bLegacy = apiBody.batches.find((b: any) => b.id === "01M6VDASHBOARDTEST00000000");
    expect(bLegacy).toBeDefined();
    expect(bLegacy.state).toBe("confirmed");
    expect(bLegacy.checkRecorded).toBe(false);
    expect(bLegacy.verificationStatus).toBe("legacy");

    db.close();
  });
});
