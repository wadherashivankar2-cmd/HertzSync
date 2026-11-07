import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import nacl from "tweetnacl";
import { NextRequest } from "next/server";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { canonicalizeEventPayload } from "../../src/lib/canonical";
import { POST as postEvent } from "../../src/app/api/v1/events/route";
import { GET as getEvent } from "../../src/app/api/v1/events/[id]/route";

const INGEST_TEST_DB = path.resolve(process.cwd(), "data/test_ingest.db");

describe("Ingest API Integration (POST & GET /api/v1/events)", () => {
  const businessId = "biz_ingest_test";
  const rawApiKey = "ts_live_key_ingest_999";
  const deviceId = "dev_ingest_001";
  let devicePrivateKeyBytes: Uint8Array;
  let devicePublicKeyBase64: string;

  beforeAll(() => {
    process.env.DB_PATH = INGEST_TEST_DB;
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${INGEST_TEST_DB}${ext}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    const db = createDatabaseConnection(INGEST_TEST_DB);
    migrate(db);

    const now = Date.now();
    const crypto = require("crypto");
    const apiKeyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");

    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(businessId, "Ingest Test Biz", apiKeyHash, now);

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run("payee_ingest", businessId, "Ingest Payee", "83cx4jH4aB7V7tFGr79R1f4zW9mN8b1r2P3q4s5t6u7v", now);

    const keypair = nacl.sign.keyPair();
    devicePrivateKeyBytes = keypair.secretKey;
    devicePublicKeyBase64 = Buffer.from(keypair.publicKey).toString("base64");

    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(deviceId, businessId, "payee_ingest", devicePublicKeyBase64, now);

    db.close();
  });

  afterAll(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${INGEST_TEST_DB}${ext}`;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
  });

  function createSignedRequest(
    payload: {
      epoch: number;
      seq: number;
      amountLamports: number;
      occurredAt: number;
    },
    apiKey: string = rawApiKey,
    customDeviceId: string = deviceId,
    customKeyBytes = devicePrivateKeyBytes,
    customBusinessId = businessId
  ) {
    const canonicalPayload = {
      amountLamports: payload.amountLamports,
      businessId: customBusinessId,
      deviceId: customDeviceId,
      epoch: payload.epoch,
      occurredAt: payload.occurredAt,
      seq: payload.seq,
    };

    const canonicalJson = canonicalizeEventPayload(canonicalPayload);
    const sigBytes = nacl.sign.detached(new Uint8Array(Buffer.from(canonicalJson, "utf8")), customKeyBytes);
    const signature = Buffer.from(sigBytes).toString("base64");

    return new NextRequest("http://localhost:3000/api/v1/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        deviceId: customDeviceId,
        epoch: payload.epoch,
        seq: payload.seq,
        amountLamports: payload.amountLamports,
        occurredAt: payload.occurredAt,
        signature,
      }),
    });
  }

  it("accepts a valid signed event and returns 202 queued", async () => {
    const req = createSignedRequest({
      epoch: 10,
      seq: 1,
      amountLamports: 50000,
      occurredAt: Date.now(),
    });

    const res = await postEvent(req);
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.id).toBe(`${deviceId}:10:1`);
    expect(data.state).toBe("queued");
  });

  it("handles duplicate retransmission with 200 duplicate:true", async () => {
    const payload = {
      epoch: 10,
      seq: 2,
      amountLamports: 60000,
      occurredAt: 1700000000000,
    };

    const req1 = createSignedRequest(payload);
    const res1 = await postEvent(req1);
    expect(res1.status).toBe(202);

    // Retransmit identical event
    const req2 = createSignedRequest(payload);
    const res2 = await postEvent(req2);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.duplicate).toBe(true);
    expect(data2.id).toBe(`${deviceId}:10:2`);
  });

  it("rejects conflict with 409 when same key has different content", async () => {
    const now = 1700000000000;
    const req1 = createSignedRequest({
      epoch: 10,
      seq: 3,
      amountLamports: 70000,
      occurredAt: now,
    });
    const res1 = await postEvent(req1);
    expect(res1.status).toBe(202);

    // Send with altered amount under SAME epoch & seq
    const req2 = createSignedRequest({
      epoch: 10,
      seq: 3,
      amountLamports: 88888,
      occurredAt: now,
    });
    const res2 = await postEvent(req2);
    expect(res2.status).toBe(409);
    const errData = await res2.json();
    expect(errData.error.code).toBe("event_conflict");
  });

  it("rejects invalid signature with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify({
        deviceId,
        epoch: 10,
        seq: 4,
        amountLamports: 50000,
        occurredAt: Date.now(),
        signature: Buffer.from("invalid_signature_bytes_here_padded_to_64_bytes_test_padding_1234").toString("base64"),
      }),
    });

    const res = await postEvent(req);
    expect(res.status).toBe(401);
  });

  it("rejects unauthorized API key with 401", async () => {
    const req = createSignedRequest(
      {
        epoch: 10,
        seq: 5,
        amountLamports: 50000,
        occurredAt: Date.now(),
      },
      "wrong_api_key"
    );

    const res = await postEvent(req);
    expect(res.status).toBe(401);
  });

  it("rejects device belonging to another business with 403", async () => {
    const otherBizId = "biz_other_02";
    const db = createDatabaseConnection(INGEST_TEST_DB);
    db.prepare("INSERT OR REPLACE INTO businesses (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)").run(
      otherBizId, "Other Biz", "other_hash_abc", Date.now()
    );

    const otherKeypair = nacl.sign.keyPair();
    db.prepare("INSERT OR REPLACE INTO devices (id, business_id, payee_id, public_key, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)").run(
      "dev_other_001", otherBizId, "payee_ingest", Buffer.from(otherKeypair.publicKey).toString("base64"), Date.now()
    );
    db.close();

    // Business 1 tries to submit event for Business 2's device
    const req = createSignedRequest(
      {
        epoch: 10,
        seq: 6,
        amountLamports: 50000,
        occurredAt: Date.now(),
      },
      rawApiKey,
      "dev_other_001",
      otherKeypair.secretKey
    );

    const res = await postEvent(req);
    expect(res.status).toBe(403);
  });

  it("handles device reset with new epoch: returns 202 and registers new epoch in audit log", async () => {
    const newEpoch = 20;
    const req = createSignedRequest({
      epoch: newEpoch,
      seq: 1,
      amountLamports: 55000,
      occurredAt: Date.now(),
    });

    const res = await postEvent(req);
    expect(res.status).toBe(202);

    const db = createDatabaseConnection(INGEST_TEST_DB);
    const audit = db.prepare("SELECT * FROM audit_log WHERE action = 'new_epoch_registered' AND detail LIKE ?").get(`%${newEpoch}%`);
    expect(audit).toBeDefined();
    db.close();
  });

  it("fetches event status via GET /api/v1/events/:id", async () => {
    const req = new NextRequest(`http://localhost:3000/api/v1/events/${deviceId}:10:1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${rawApiKey}`,
      },
    });

    const res = await getEvent(req, { params: Promise.resolve({ id: `${deviceId}:10:1` }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(`${deviceId}:10:1`);
    expect(data.state).toBe("queued");
    expect(data.signature).toBeUndefined();
  });
});
