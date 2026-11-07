import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import nacl from "tweetnacl";
import { NextRequest } from "next/server";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { canonicalizeEventPayload } from "../../src/lib/canonical";
import { POST as postEvent } from "../../src/app/api/v1/events/route";

const SECURITY_TEST_DB = path.resolve(process.cwd(), "data/test_security.db");

describe("Ingest Security Hardening (S1, S2, S3, S6, S10, S11, S16, S17)", () => {
  const businessId = "biz_security_test";
  const rawApiKey = "ts_live_key_sec_12345";
  const deviceId = "dev_sec_001";
  let devicePrivateKeyBytes: Uint8Array;
  let devicePublicKeyBase64: string;

  beforeAll(() => {
    process.env.DB_PATH = SECURITY_TEST_DB;
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${SECURITY_TEST_DB}${ext}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    const db = createDatabaseConnection(SECURITY_TEST_DB);
    migrate(db);

    const now = Date.now();
    const crypto = require("crypto");
    const apiKeyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");

    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(businessId, "Security Test Biz", apiKeyHash, now);

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run("payee_sec", businessId, "Security Payee", "83cx4jH4aB7V7tFGr79R1f4zW9mN8b1r2P3q4s5t6u7v", now);

    const keypair = nacl.sign.keyPair();
    devicePrivateKeyBytes = keypair.secretKey;
    devicePublicKeyBase64 = Buffer.from(keypair.publicKey).toString("base64");

    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(deviceId, businessId, "payee_sec", devicePublicKeyBase64, now);

    db.close();
  });

  afterAll(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${SECURITY_TEST_DB}${ext}`;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
  });

  function makeReq(body: any, apiKey = rawApiKey) {
    return new NextRequest("http://localhost:3000/api/v1/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  function signPayload(payload: {
    epoch: number;
    seq: number;
    amountLamports: number;
    occurredAt: number;
  }) {
    const canonicalJson = canonicalizeEventPayload({
      ...payload,
      businessId,
      deviceId,
    });
    const sig = nacl.sign.detached(new Uint8Array(Buffer.from(canonicalJson, "utf8")), devicePrivateKeyBytes);
    return Buffer.from(sig).toString("base64");
  }

  it("S1: Replayed event with same content creates exactly 1 row after 20 sends", async () => {
    const payload = { epoch: 500, seq: 1, amountLamports: 10000, occurredAt: 1700000000000 };
    const signature = signPayload(payload);
    const body = { deviceId, ...payload, signature };

    for (let i = 0; i < 20; i++) {
      const res = await postEvent(makeReq(body));
      expect([200, 202]).toContain(res.status);
    }

    const db = createDatabaseConnection(SECURITY_TEST_DB);
    const count = db.prepare("SELECT count(*) as c FROM events WHERE device_id = ? AND epoch = ? AND seq = ?").get(deviceId, 500, 1) as any;
    expect(count.c).toBe(1);
    db.close();
  });

  it("S2: Forged event with altered amount is rejected with 401", async () => {
    const payload = { epoch: 500, seq: 2, amountLamports: 10000, occurredAt: 1700000000000 };
    const signature = signPayload(payload);
    const forgedBody = { deviceId, ...payload, amountLamports: 99999999, signature };

    const res = await postEvent(makeReq(forgedBody));
    expect(res.status).toBe(401);
  });

  it("S6: Database dump contains no raw API keys", () => {
    const db = createDatabaseConnection(SECURITY_TEST_DB);
    const rows = db.prepare("SELECT api_key_hash FROM businesses").all() as any[];
    for (const r of rows) {
      expect(r.api_key_hash).not.toBe(rawApiKey);
      expect(r.api_key_hash).toHaveLength(64);
    }
    db.close();
  });

  it("S11: Table of 30 malformed payloads all return 400", async () => {
    const badPayloads = [
      null,
      {},
      { deviceId: "" },
      { deviceId: 123 },
      { deviceId, epoch: "one" },
      { deviceId, epoch: -1 },
      { deviceId, epoch: 0 },
      { deviceId, epoch: 1.5 },
      { deviceId, epoch: 1, seq: -5 },
      { deviceId, epoch: 1, seq: 0 },
      { deviceId, epoch: 1, seq: "two" },
      { deviceId, epoch: 1, seq: 2.2 },
      { deviceId, epoch: 1, seq: 1, amountLamports: 0 },
      { deviceId, epoch: 1, seq: 1, amountLamports: -100 },
      { deviceId, epoch: 1, seq: 1, amountLamports: "50000" },
      { deviceId, epoch: 1, seq: 1, amountLamports: 50.5 },
      { deviceId, epoch: 1, seq: 1, amountLamports: 50000, occurredAt: -1 },
      { deviceId, epoch: 1, seq: 1, amountLamports: 50000, occurredAt: "yesterday" },
      { deviceId, epoch: 1, seq: 1, amountLamports: 50000, occurredAt: 1700000000000, signature: "" },
      { deviceId, epoch: 1, seq: 1, amountLamports: 50000, occurredAt: 1700000000000, signature: 12345 },
      { deviceId, epoch: 1, seq: 1, amountLamports: 50000, occurredAt: 1700000000000 },
      { deviceId, epoch: 1, seq: 1, amountLamports: 50000, occurredAt: 1700000000000, signature: null },
      { deviceId, epoch: 1, seq: 1, amountLamports: 999999999999, occurredAt: 1700000000000, signature: "abc" },
      { deviceId, epoch: 1, seq: 1, amountLamports: NaN, occurredAt: 1700000000000, signature: "abc" },
      { deviceId, epoch: 1, seq: 1, amountLamports: Infinity, occurredAt: 1700000000000, signature: "abc" },
      { deviceId, epoch: NaN, seq: 1, amountLamports: 50000, occurredAt: 1700000000000, signature: "abc" },
      { deviceId, epoch: 1, seq: NaN, amountLamports: 50000, occurredAt: 1700000000000, signature: "abc" },
      { deviceId, epoch: 1, seq: 1, amountLamports: 50000, occurredAt: NaN, signature: "abc" },
      { deviceId, epoch: 1, seq: 1, amountLamports: null, occurredAt: 1700000000000, signature: "abc" },
      { deviceId, epoch: null, seq: 1, amountLamports: 50000, occurredAt: 1700000000000, signature: "abc" },
    ];

    expect(badPayloads).toHaveLength(30);

    for (const bad of badPayloads) {
      const res = await postEvent(makeReq(bad));
      expect(res.status).toBe(400);
    }
  });

  it("S17: Conflicting content returns 409 and leaves original row intact", async () => {
    const payload1 = { epoch: 600, seq: 1, amountLamports: 25000, occurredAt: 1700000000000 };
    const sig1 = signPayload(payload1);
    const res1 = await postEvent(makeReq({ deviceId, ...payload1, signature: sig1 }));
    expect(res1.status).toBe(202);

    // Send different amount under same epoch & seq
    const payload2 = { epoch: 600, seq: 1, amountLamports: 35000, occurredAt: 1700000000000 };
    const sig2 = signPayload(payload2);
    const res2 = await postEvent(makeReq({ deviceId, ...payload2, signature: sig2 }));
    expect(res2.status).toBe(409);

    const db = createDatabaseConnection(SECURITY_TEST_DB);
    const event = db.prepare("SELECT amount_lamports FROM events WHERE id = ?").get(`${deviceId}:600:1`) as any;
    expect(event.amount_lamports).toBe(25000);
    db.close();
  });
});
