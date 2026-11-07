import fs from "fs";
import path from "path";
import nacl from "tweetnacl";
import { canonicalizeEventPayload, CanonicalEventPayload } from "../src/lib/canonical";

export interface DeviceKeyFile {
  id: string;
  publicKey: string; // base64
  secretKey: number[]; // 64-byte Uint8Array as array
}

export interface DeviceState {
  deviceId: string;
  epoch: number;
  seq: number;
  lastSentAt: number;
}

export interface SimulatorEvent {
  deviceId: string;
  epoch: number;
  seq: number;
  amountLamports: number;
  occurredAt: number;
  signature: string;
}

/**
 * Loads or creates an Ed25519 keypair for a device.
 * Private keys stay in keys/devices/ only. NEVER prints or logs secretKey bytes.
 * Blueprint Section 10 (Phase 5).
 */
export function loadOrCreateDeviceKey(
  deviceId: string,
  devicesDir: string = path.resolve(process.cwd(), "keys", "devices")
): nacl.SignKeyPair {
  if (!fs.existsSync(devicesDir)) {
    fs.mkdirSync(devicesDir, { recursive: true, mode: 0o700 });
  }

  const keyFilePath = path.join(devicesDir, `${deviceId}.json`);

  if (fs.existsSync(keyFilePath)) {
    try {
      const data: DeviceKeyFile = JSON.parse(fs.readFileSync(keyFilePath, "utf8"));
      if (data && Array.isArray(data.secretKey) && data.secretKey.length === 64) {
        return nacl.sign.keyPair.fromSecretKey(new Uint8Array(data.secretKey));
      }
    } catch {}
  }

  // Generate new Ed25519 keypair
  const newKeypair = nacl.sign.keyPair();
  const fileData: DeviceKeyFile = {
    id: deviceId,
    publicKey: Buffer.from(newKeypair.publicKey).toString("base64"),
    secretKey: Array.from(newKeypair.secretKey),
  };

  fs.writeFileSync(keyFilePath, JSON.stringify(fileData, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });

  return newKeypair;
}

/**
 * Loads current epoch and seq state from per-device state file.
 * Returns default { deviceId, epoch: 1, seq: 0, lastSentAt: 0 } if not found.
 */
export function loadDeviceState(
  deviceId: string,
  devicesDir: string = path.resolve(process.cwd(), "keys", "devices")
): DeviceState {
  const stateFilePath = path.join(devicesDir, `${deviceId}.state.json`);
  if (fs.existsSync(stateFilePath)) {
    try {
      const data: DeviceState = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
      if (data && typeof data.epoch === "number" && typeof data.seq === "number") {
        return data;
      }
    } catch {}
  }

  return {
    deviceId,
    epoch: 1,
    seq: 0,
    lastSentAt: 0,
  };
}

/**
 * Persists current epoch and seq state to keys/devices/<id>.state.json after every accepted send.
 */
export function saveDeviceState(
  state: DeviceState,
  devicesDir: string = path.resolve(process.cwd(), "keys", "devices")
): void {
  if (!fs.existsSync(devicesDir)) {
    fs.mkdirSync(devicesDir, { recursive: true, mode: 0o700 });
  }

  const stateFilePath = path.join(devicesDir, `${state.deviceId}.state.json`);
  const tmpPath = `${stateFilePath}.tmp.${Date.now()}`;

  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmpPath, stateFilePath);
}

/**
 * Performs legitimate device reset:
 * Deletes keys/devices/<id>.state.json ONLY.
 * NEVER deletes or modifies keys/devices/<id>.json.
 * Increments epoch and resets seq to 0.
 */
export function resetDeviceState(
  deviceId: string,
  devicesDir: string = path.resolve(process.cwd(), "keys", "devices")
): { previousEpoch: number; newEpoch: number; stateFileDeleted: boolean; keyFilePreserved: boolean } {
  const keyFilePath = path.join(devicesDir, `${deviceId}.json`);
  const stateFilePath = path.join(devicesDir, `${deviceId}.state.json`);

  const initialKeyStats = fs.existsSync(keyFilePath) ? fs.statSync(keyFilePath) : null;
  const currentState = loadDeviceState(deviceId, devicesDir);
  const previousEpoch = currentState.epoch;
  const newEpoch = previousEpoch + 1;

  let stateFileDeleted = false;
  if (fs.existsSync(stateFilePath)) {
    fs.unlinkSync(stateFilePath);
    stateFileDeleted = true;
  }

  // Confirm key file was NOT deleted or touched
  const postKeyStats = fs.existsSync(keyFilePath) ? fs.statSync(keyFilePath) : null;
  const keyFilePreserved =
    initialKeyStats !== null &&
    postKeyStats !== null &&
    initialKeyStats.size === postKeyStats.size &&
    initialKeyStats.mtimeMs === postKeyStats.mtimeMs;

  return {
    previousEpoch,
    newEpoch,
    stateFileDeleted,
    keyFilePreserved,
  };
}

/**
 * Builds a signed event request payload using the device's private key.
 */
export function createSignedEvent(
  deviceId: string,
  keypair: nacl.SignKeyPair,
  epoch: number,
  seq: number,
  amountLamports: number,
  businessId: string,
  occurredAt: number = Date.now()
): SimulatorEvent {
  const canonicalPayload: CanonicalEventPayload = {
    amountLamports,
    businessId,
    deviceId,
    epoch,
    occurredAt,
    seq,
  };

  const canonicalJson = canonicalizeEventPayload(canonicalPayload);
  const signatureBytes = nacl.sign.detached(Buffer.from(canonicalJson, "utf8"), keypair.secretKey);
  const signature = Buffer.from(signatureBytes).toString("base64");

  return {
    deviceId,
    epoch,
    seq,
    amountLamports,
    occurredAt,
    signature,
  };
}

/**
 * Formats one plain-language line per event: "Charger 2 recorded 0.05 SOL session #17".
 */
export function formatPlainLanguageEvent(
  deviceId: string,
  amountLamports: number,
  seq: number,
  label?: string
): string {
  const name = label || deviceId;
  const sol = (amountLamports / 1e9).toFixed(amountLamports % 1e7 === 0 ? 2 : 4);
  return `${name} recorded ${sol} SOL session #${seq}`;
}

export type SimulatorMode = "normal" | "burst" | "offline" | "reset";

export interface SimulatorOptions {
  devicesDir?: string;
  businessId?: string;
  apiKey?: string;
  apiBaseUrl?: string;
  mode?: SimulatorMode;
  ratePerSec?: number;
  burstCount?: number;
}

export class DeviceSimulator {
  private deviceId: string;
  private label: string;
  private devicesDir: string;
  private businessId: string;
  private keypair: nacl.SignKeyPair;
  private state: DeviceState;
  private offlineBuffer: SimulatorEvent[] = [];
  private isRunning = false;

  constructor(deviceId: string, label?: string, options?: SimulatorOptions) {
    this.deviceId = deviceId;
    this.label = label || deviceId;
    this.devicesDir = options?.devicesDir || path.resolve(process.cwd(), "keys", "devices");
    this.businessId = options?.businessId || "biz_01";
    this.keypair = loadOrCreateDeviceKey(this.deviceId, this.devicesDir);
    this.state = loadDeviceState(this.deviceId, this.devicesDir);

    // Setup graceful SIGINT handling
    if (typeof process !== "undefined" && process.on) {
      process.once("SIGINT", () => {
        this.saveState();
      });
    }
  }

  public getPublicKeyBase64(): string {
    return Buffer.from(this.keypair.publicKey).toString("base64");
  }

  public getState(): DeviceState {
    return { ...this.state };
  }

  public saveState(): void {
    saveDeviceState(this.state, this.devicesDir);
  }

  /**
   * Generates next signed event in sequence.
   */
  public generateNextEvent(amountLamports: number = 50_000_000, occurredAt?: number): SimulatorEvent {
    this.state.seq += 1;
    const event = createSignedEvent(
      this.deviceId,
      this.keypair,
      this.state.epoch,
      this.state.seq,
      amountLamports,
      this.businessId,
      occurredAt
    );
    return event;
  }

  /**
   * Records event as accepted and commits state file.
   */
  public onEventAccepted(event: SimulatorEvent): void {
    this.state.epoch = event.epoch;
    this.state.seq = event.seq;
    this.state.lastSentAt = Date.now();
    this.saveState();

    const logLine = formatPlainLanguageEvent(this.deviceId, event.amountLamports, event.seq, this.label);
    console.log(logLine);
  }

  /**
   * Offline mode: buffers event locally without sending.
   */
  public bufferOfflineEvent(amountLamports: number = 50_000_000, occurredAt?: number): SimulatorEvent {
    const event = this.generateNextEvent(amountLamports, occurredAt);
    this.offlineBuffer.push(event);
    return event;
  }

  public getOfflineBuffer(): SimulatorEvent[] {
    return [...this.offlineBuffer];
  }

  /**
   * Reconnect: delivers buffered events in sequence order with no gaps.
   */
  public async flushOfflineBuffer(
    sendFn: (event: SimulatorEvent) => Promise<{ status: number; duplicate?: boolean }>
  ): Promise<{ delivered: number; failed: number }> {
    // Sort strictly by epoch ASC, seq ASC
    this.offlineBuffer.sort((a, b) => {
      if (a.epoch !== b.epoch) return a.epoch - b.epoch;
      return a.seq - b.seq;
    });

    let delivered = 0;
    let failed = 0;

    const remaining: SimulatorEvent[] = [];
    for (const ev of this.offlineBuffer) {
      try {
        const res = await sendFn(ev);
        if (res.status === 200 || res.status === 201) {
          this.onEventAccepted(ev);
          delivered++;
        } else {
          failed++;
          remaining.push(ev);
        }
      } catch {
        failed++;
        remaining.push(ev);
      }
    }

    this.offlineBuffer = remaining;
    return { delivered, failed };
  }

  /**
   * Reset mode: deletes state file only, resumes with epoch + 1.
   */
  public reset(newEpochOverride?: number): { previousEpoch: number; newEpoch: number } {
    const res = resetDeviceState(this.deviceId, this.devicesDir);
    const newEpoch = newEpochOverride || res.newEpoch;
    this.state = {
      deviceId: this.deviceId,
      epoch: newEpoch,
      seq: 0,
      lastSentAt: 0,
    };
    this.offlineBuffer = [];
    return { previousEpoch: res.previousEpoch, newEpoch };
  }
}

