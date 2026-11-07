import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { fork } from "child_process";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";

const TEST_DB_PATH = path.resolve(process.cwd(), "data/test_integration.db");

describe("Database Integration & SQLite Pragmas", () => {
  beforeAll(() => {
    // Clean previous test db
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${TEST_DB_PATH}${ext}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  afterAll(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${TEST_DB_PATH}${ext}`;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
  });

  it("verifies pragmas and version match requirements", () => {
    const db = createDatabaseConnection(TEST_DB_PATH);
    migrate(db);

    const busyTimeout = db.pragma("busy_timeout", { simple: true });
    const journalMode = db.pragma("journal_mode", { simple: true });
    const foreignKeys = db.pragma("foreign_keys", { simple: true });
    const versionRow = db.prepare("SELECT sqlite_version() as v").get() as { v: string };

    expect(busyTimeout).toBe(5000);
    expect(journalMode).toBe("wal");
    expect(foreignKeys).toBe(1);

    const parts = versionRow.v.split(".").map(Number);
    expect(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 35)).toBe(true);

    db.close();
  });

  it("writes, reopens connection, and reads data back accurately", () => {
    let db = createDatabaseConnection(TEST_DB_PATH);
    const now = Date.now();

    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run("biz_test_reopen", "Test Biz", "hash_123", now);

    db.close();

    // Reopen
    db = createDatabaseConnection(TEST_DB_PATH);
    const row = db.prepare("SELECT * FROM businesses WHERE id = ?").get("biz_test_reopen") as any;
    expect(row).toBeDefined();
    expect(row.name).toBe("Test Biz");
    expect(row.api_key_hash).toBe("hash_123");

    db.close();
  });

  it("fires UNIQUE (device_id, epoch, seq) constraint", () => {
    const db = createDatabaseConnection(TEST_DB_PATH);
    const now = Date.now();

    // Setup foreign keys: business, payee, device
    db.prepare(`
      INSERT OR IGNORE INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_unique', 'Unique Test', 'hash_unique', ?)
    `).run(now);

    db.prepare(`
      INSERT OR IGNORE INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_unique', 'biz_unique', 'Payee', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', ?)
    `).run(now);

    db.prepare(`
      INSERT OR IGNORE INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES ('dev_unique', 'biz_unique', 'payee_unique', 'pubkey_base64', 'active', ?)
    `).run(now);

    // First event insert
    db.prepare(`
      INSERT INTO events (
        id, business_id, device_id, epoch, seq, amount_lamports,
        occurred_at, received_at, payload_hash, signature, state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "dev_unique:1:1",
      "biz_unique",
      "dev_unique",
      1,
      1,
      50000,
      now,
      now,
      "hash1",
      "sig1",
      "queued"
    );

    // Second event insert with identical (device_id, epoch, seq)
    expect(() => {
      db.prepare(`
        INSERT INTO events (
          id, business_id, device_id, epoch, seq, amount_lamports,
          occurred_at, received_at, payload_hash, signature, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "dev_unique:1:1_different_id",
        "biz_unique",
        "dev_unique",
        1,
        1,
        60000,
        now,
        now,
        "hash2",
        "sig2",
        "queued"
      );
    }).toThrow(/UNIQUE constraint failed: events.device_id, events.epoch, events.seq/);

    db.close();
  });

  it("handles concurrent writes from two processes without SQLITE_BUSY error", async () => {
    const db = createDatabaseConnection(TEST_DB_PATH);

    // Spawn child worker process that writes 50 rows in transactions
    const childScript = `
      const Database = require('better-sqlite3');
      const db = new Database(process.env.TEST_DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 5000');
      
      for (let i = 0; i < 50; i++) {
        db.prepare("INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT (name) DO UPDATE SET value = value + 1").run('child_counter');
      }
      db.close();
      process.exit(0);
    `;

    const child = fork("-e", [childScript], {
      env: { ...process.env, TEST_DB_PATH },
      stdio: "inherit",
    });

    // Parent also writes concurrently
    for (let i = 0; i < 50; i++) {
      db.prepare(
        "INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT (name) DO UPDATE SET value = value + 1"
      ).run("parent_counter");
    }

    await new Promise<void>((resolve, reject) => {
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Child exited with code ${code}`));
      });
      child.on("error", reject);
    });

    const parentVal = db.prepare("SELECT value FROM counters WHERE name = 'parent_counter'").pluck().get();
    const childVal = db.prepare("SELECT value FROM counters WHERE name = 'child_counter'").pluck().get();

    expect(parentVal).toBe(50);
    expect(childVal).toBe(50);

    db.close();
  });
});

