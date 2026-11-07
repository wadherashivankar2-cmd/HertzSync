import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  DeviceSimulator,
  loadOrCreateDeviceKey,
  loadDeviceState,
  saveDeviceState,
  resetDeviceState,
  createSignedEvent,
  formatPlainLanguageEvent,
} from "../../scripts/device-sim";
import { verifyEd25519Signature } from "../../src/lib/crypto";
import { canonicalizeEventPayload } from "../../src/lib/canonical";

const TEST_DEVICES_DIR = path.resolve(process.cwd(), "keys", "devices", "test_sim");

describe("Device Simulator Unit Tests (Blueprint Section 10 Phase 5)", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DEVICES_DIR)) {
      fs.rmSync(TEST_DEVICES_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DEVICES_DIR, { recursive: true, mode: 0o700 });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DEVICES_DIR)) {
      fs.rmSync(TEST_DEVICES_DIR, { recursive: true, force: true });
    }
  });

  it("produces Ed25519 signatures matching src/lib/crypto verifier", () => {
    const deviceId = "dev_sim_test_01";
    const sim = new DeviceSimulator(deviceId, "Test Charger 1", {
      devicesDir: TEST_DEVICES_DIR,
      businessId: "biz_test_01",
    });

    const event = sim.generateNextEvent(50_000_000);
    const pubKeyBase64 = sim.getPublicKeyBase64();

    const canonicalJson = canonicalizeEventPayload({
      amountLamports: event.amountLamports,
      businessId: "biz_test_01",
      deviceId: event.deviceId,
      epoch: event.epoch,
      occurredAt: event.occurredAt,
      seq: event.seq,
    });

    const isValid = verifyEd25519Signature(canonicalJson, event.signature, pubKeyBase64);
    expect(isValid).toBe(true);

    // Corrupted message must fail
    const isCorruptedValid = verifyEd25519Signature(canonicalJson + "tamper", event.signature, pubKeyBase64);
    expect(isCorruptedValid).toBe(false);
  });

  it("persists epoch and seq state to state file and resumes sequence seamlessly on restart", () => {
    const deviceId = "dev_sim_persist_01";

    // 1. First simulator instance sends 3 events
    const sim1 = new DeviceSimulator(deviceId, "Charger 1", {
      devicesDir: TEST_DEVICES_DIR,
    });

    expect(sim1.getState().epoch).toBe(1);
    expect(sim1.getState().seq).toBe(0);

    const ev1 = sim1.generateNextEvent(10_000);
    sim1.onEventAccepted(ev1);

    const ev2 = sim1.generateNextEvent(20_000);
    sim1.onEventAccepted(ev2);

    const ev3 = sim1.generateNextEvent(30_000);
    sim1.onEventAccepted(ev3);

    expect(sim1.getState().seq).toBe(3);

    // Verify state file on disk
    const statePath = path.join(TEST_DEVICES_DIR, `${deviceId}.state.json`);
    expect(fs.existsSync(statePath)).toBe(true);
    const onDiskState = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(onDiskState.epoch).toBe(1);
    expect(onDiskState.seq).toBe(3);

    // 2. Second simulator instance simulates restart
    const sim2 = new DeviceSimulator(deviceId, "Charger 1", {
      devicesDir: TEST_DEVICES_DIR,
    });

    expect(sim2.getState().epoch).toBe(1);
    expect(sim2.getState().seq).toBe(3);

    // Next event must be seq 4 with no gaps
    const ev4 = sim2.generateNextEvent(40_000);
    expect(ev4.seq).toBe(4);
    sim2.onEventAccepted(ev4);

    expect(sim2.getState().seq).toBe(4);
  });

  it("buffers offline events locally and flushes strictly in sequence order with no gaps", async () => {
    const deviceId = "dev_sim_offline_01";
    const sim = new DeviceSimulator(deviceId, "Offline Charger", {
      devicesDir: TEST_DEVICES_DIR,
    });

    // Buffer 5 events offline
    for (let i = 1; i <= 5; i++) {
      sim.bufferOfflineEvent(10_000 * i);
    }

    const buffered = sim.getOfflineBuffer();
    expect(buffered.length).toBe(5);
    expect(buffered.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);

    // Flush to mock receiver
    const receivedSeqs: number[] = [];
    const flushResult = await sim.flushOfflineBuffer(async (ev) => {
      receivedSeqs.push(ev.seq);
      return { status: 200 };
    });

    expect(flushResult.delivered).toBe(5);
    expect(flushResult.failed).toBe(0);
    expect(receivedSeqs).toEqual([1, 2, 3, 4, 5]);
    expect(sim.getOfflineBuffer().length).toBe(0);
    expect(sim.getState().seq).toBe(5);
  });

  it("explicitly confirms reset mode deletes keys/devices/<id>.state.json ONLY and NEVER deletes or modifies keys/devices/<id>.json", () => {
    const deviceId = "dev_sim_reset_guard";
    const sim = new DeviceSimulator(deviceId, "Guarded Device", {
      devicesDir: TEST_DEVICES_DIR,
    });

    // Generate event to create state file
    const ev1 = sim.generateNextEvent(50_000_000);
    sim.onEventAccepted(ev1);

    const keyFilePath = path.join(TEST_DEVICES_DIR, `${deviceId}.json`);
    const stateFilePath = path.join(TEST_DEVICES_DIR, `${deviceId}.state.json`);

    // Verify both files exist
    expect(fs.existsSync(keyFilePath)).toBe(true);
    expect(fs.existsSync(stateFilePath)).toBe(true);

    const originalKeyContent = fs.readFileSync(keyFilePath, "utf8");
    const originalKeyStats = fs.statSync(keyFilePath);

    // Perform reset
    const resetResult = sim.reset();

    expect(resetResult.previousEpoch).toBe(1);
    expect(resetResult.newEpoch).toBe(2);

    // 1. Assert state file is DELETED
    expect(fs.existsSync(stateFilePath)).toBe(false);

    // 2. Assert key file is NEVER deleted or modified
    expect(fs.existsSync(keyFilePath)).toBe(true);
    const postResetKeyContent = fs.readFileSync(keyFilePath, "utf8");
    const postResetKeyStats = fs.statSync(keyFilePath);

    expect(postResetKeyContent).toBe(originalKeyContent);
    expect(postResetKeyStats.size).toBe(originalKeyStats.size);
    expect(postResetKeyStats.mtimeMs).toBe(originalKeyStats.mtimeMs);

    // Simulator resumes with epoch = 2, seq = 0
    expect(sim.getState().epoch).toBe(2);
    expect(sim.getState().seq).toBe(0);

    // Next event is epoch 2, seq 1
    const nextEv = sim.generateNextEvent(50_000_000);
    expect(nextEv.epoch).toBe(2);
    expect(nextEv.seq).toBe(1);
  });

  it("formats human-readable plain language event log line", () => {
    const line = formatPlainLanguageEvent("dev_charger_02", 50_000_000, 17, "Charger 2");
    expect(line).toBe("Charger 2 recorded 0.05 SOL session #17");
  });
});

