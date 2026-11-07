import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { POST as postEvent } from "../../src/app/api/v1/events/route";
import { DeviceSimulator, resetDeviceState } from "../../scripts/device-sim";

const RESET_TEST_DB = path.resolve(process.cwd(), "data/test_device_reset.db");
const TEST_DEVICES_DIR = path.resolve(process.cwd(), "keys/devices/test_reset");

describe("Device Reset Integration Test (Blueprint S16 & Phase 5)", () => {
  const businessId = "biz_reset_test";
  const rawApiKey = "ts_live_key_reset_test_123";
  const deviceId = "charger_reset_01";
  let sim: DeviceSimulator;

  beforeAll(() => {
    process.env.DB_PATH = RESET_TEST_DB;

    // Clean up test DB artifacts
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${RESET_TEST_DB}${ext}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    // Clean up test devices dir
    if (fs.existsSync(TEST_DEVICES_DIR)) {
      fs.rmSync(TEST_DEVICES_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DEVICES_DIR, { recursive: true });

    // Initialize test database
    const db = createDatabaseConnection(RESET_TEST_DB);
    migrate(db);

    const now = Date.now();
    const apiKeyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");

    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(businessId, "Reset Test Business", apiKeyHash, now);

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run("payee_reset", businessId, "Reset Test Payee", "25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr", now);

    // Initialize DeviceSimulator pointing to our test devices dir
    sim = new DeviceSimulator(deviceId, "Charger Reset Unit", {
      devicesDir: TEST_DEVICES_DIR,
      businessId,
    });

    const pubKeyBase64 = sim.getPublicKeyBase64();
    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(deviceId, businessId, "payee_reset", pubKeyBase64, now);

    db.close();
  });

  afterAll(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${RESET_TEST_DB}${ext}`;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }

    if (fs.existsSync(TEST_DEVICES_DIR)) {
      try {
        fs.rmSync(TEST_DEVICES_DIR, { recursive: true, force: true });
      } catch {}
    }
  });

  async function sendSimEvent(event: ReturnType<typeof sim.generateNextEvent>) {
    const req = new NextRequest("http://localhost:3000/api/v1/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify(event),
    });

    const res = await postEvent(req);
    const data = await res.json();
    return { status: res.status, data };
  }

  it("submits events under initial epoch 1 (seq 1..5) with HTTP 202", async () => {
    for (let seq = 1; seq <= 5; seq++) {
      const event = sim.generateNextEvent(50_000_000);
      expect(event.epoch).toBe(1);
      expect(event.seq).toBe(seq);

      const res = await sendSimEvent(event);
      expect(res.status).toBe(202);
      expect(res.data.id).toBe(`${deviceId}:1:${seq}`);
      expect(res.data.state).toBe("queued");

      sim.onEventAccepted(event);
    }

    // Verify state file was created and reflects epoch 1, seq 5
    const stateFile = path.join(TEST_DEVICES_DIR, `${deviceId}.state.json`);
    expect(fs.existsSync(stateFile)).toBe(true);
    const savedState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    expect(savedState.epoch).toBe(1);
    expect(savedState.seq).toBe(5);
  });

  it("verifies reset mode deletes keys/devices/<id>.state.json ONLY and preserves keys/devices/<id>.json untouched", () => {
    const keyFile = path.join(TEST_DEVICES_DIR, `${deviceId}.json`);
    const stateFile = path.join(TEST_DEVICES_DIR, `${deviceId}.state.json`);

    expect(fs.existsSync(keyFile)).toBe(true);
    expect(fs.existsSync(stateFile)).toBe(true);

    const keyStatsBefore = fs.statSync(keyFile);

    // Trigger reset
    const resetInfo = sim.reset();
    expect(resetInfo.previousEpoch).toBe(1);
    expect(resetInfo.newEpoch).toBe(2);

    // State file MUST be deleted
    expect(fs.existsSync(stateFile)).toBe(false);

    // Key file MUST exist and be completely unmodified
    expect(fs.existsSync(keyFile)).toBe(true);
    const keyStatsAfter = fs.statSync(keyFile);
    expect(keyStatsAfter.size).toBe(keyStatsBefore.size);
    expect(keyStatsAfter.mtimeMs).toBe(keyStatsBefore.mtimeMs);
  });

  it("submits new events under epoch 2 (seq 1..5) with zero 409 conflicts", async () => {
    const state = sim.getState();
    expect(state.epoch).toBe(2);
    expect(state.seq).toBe(0);

    for (let seq = 1; seq <= 5; seq++) {
      const event = sim.generateNextEvent(60_000_000);
      expect(event.epoch).toBe(2);
      expect(event.seq).toBe(seq);

      const res = await sendSimEvent(event);
      expect(res.status).toBe(202);
      expect(res.data.id).toBe(`${deviceId}:2:${seq}`);
      expect(res.data.state).toBe("queued");

      sim.onEventAccepted(event);
    }

    // Check DB audit logs for new_epoch_registered
    const db = createDatabaseConnection(RESET_TEST_DB);
    const auditRow = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'new_epoch_registered' AND actor = 'api' ORDER BY id DESC LIMIT 1")
      .get() as { detail: string } | undefined;

    expect(auditRow).toBeDefined();
    const detail = JSON.parse(auditRow!.detail);
    expect(detail.deviceId).toBe(deviceId);
    expect(detail.epoch).toBe(2);

    db.close();
  });

  it("demonstrates that reusing (epoch 1, seq 1) with different payload produces 409 conflict", async () => {
    // Attempt to inject an event with epoch 1, seq 1 but different amount <= 100_000_000
    // This demonstrates why the reset mechanism incrementing epoch is strictly required
    const conflictingEvent = sim.generateNextEvent(75_000_000);
    conflictingEvent.epoch = 1;
    conflictingEvent.seq = 1;

    // Resign with the device key for the falsified epoch/seq
    const conflictCanonical = {
      amountLamports: conflictingEvent.amountLamports,
      businessId,
      deviceId,
      epoch: 1,
      occurredAt: conflictingEvent.occurredAt,
      seq: 1,
    };
    const { canonicalizeEventPayload } = await import("../../src/lib/canonical");
    const nacl = (await import("tweetnacl")).default;
    const { loadOrCreateDeviceKey } = await import("../../scripts/device-sim");
    const keypair = loadOrCreateDeviceKey(deviceId, TEST_DEVICES_DIR);
    const sigBytes = nacl.sign.detached(
      Buffer.from(canonicalizeEventPayload(conflictCanonical), "utf8"),
      keypair.secretKey
    );
    conflictingEvent.signature = Buffer.from(sigBytes).toString("base64");

    const res = await sendSimEvent(conflictingEvent);
    expect(res.status).toBe(409);
    expect(res.data.error.code).toBe("event_conflict");
  });
});
