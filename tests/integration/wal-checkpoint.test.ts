import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import { createDatabaseConnection, passiveCheckpoint } from "../../src/lib/db";
import { migrate } from "../../db/migrate";

const TEST_DB_PATH = path.resolve(process.cwd(), "data", "test_wal_checkpoint.db");

describe("WAL Checkpoint Concurrency (Blueprint Section 5.9)", () => {
  let writerDb: ReturnType<typeof createDatabaseConnection>;
  let readerDb: ReturnType<typeof createDatabaseConnection>;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {}
    }
    const walFile = `${TEST_DB_PATH}-wal`;
    const shmFile = `${TEST_DB_PATH}-shm`;
    if (fs.existsSync(walFile)) {
      try {
        fs.unlinkSync(walFile);
      } catch {}
    }
    if (fs.existsSync(shmFile)) {
      try {
        fs.unlinkSync(shmFile);
      } catch {}
    }

    writerDb = createDatabaseConnection(TEST_DB_PATH);
    migrate(writerDb);

    writerDb.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_01', 'Test Biz', 'hash_01', 1000)
    `).run();

    writerDb.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_01', 'biz_01', 'Payee Site 1', '25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr', 1000)
    `).run();

    writerDb.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES ('dev_01', 'biz_01', 'payee_01', 'pub_01', 'active', 1000)
    `).run();

    readerDb = createDatabaseConnection(TEST_DB_PATH);
  });

  afterEach(() => {
    if (readerDb) {
      try {
        readerDb.close();
      } catch {}
    }
    if (writerDb) {
      try {
        writerDb.close();
      } catch {}
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {}
    }
  });

  it("passive checkpoint executes safely during burst writes, and reads succeed without blocking", async () => {
    let writesDone = false;
    let writeErrors: Error[] = [];
    let readCount = 0;
    let readErrors: Error[] = [];

    // 1. Start continuous burst writes on writerDb
    const writePromise = (async () => {
      const insertStmt = writerDb.prepare(`
        INSERT INTO events (
          id, business_id, device_id, epoch, seq, amount_lamports,
          occurred_at, received_at, payload_hash, signature, state
        ) VALUES (
          ?, 'biz_01', 'dev_01', 1, ?, 10000,
          1000, 1000, ?, ?, 'queued'
        )
      `);

      for (let i = 1; i <= 100; i++) {
        try {
          insertStmt.run(`ev_wal_${i}`, i, `hash_${i}`, `sig_${i}`);
          if (i % 20 === 0) {
            await new Promise((r) => setTimeout(r, 5));
          }
        } catch (err: any) {
          writeErrors.push(err);
        }
      }
      writesDone = true;
    })();

    // 2. Start continuous reads on readerDb
    const readPromise = (async () => {
      const countStmt = readerDb.prepare("SELECT count(*) as count FROM events");
      while (!writesDone) {
        try {
          const row = countStmt.get() as { count: number };
          expect(row.count).toBeGreaterThanOrEqual(0);
          readCount++;
          await new Promise((r) => setTimeout(r, 2));
        } catch (err: any) {
          readErrors.push(err);
        }
      }
    })();

    // 3. Execute passive checkpoints mid-burst from writer connection
    await new Promise((r) => setTimeout(r, 15));
    expect(() => {
      passiveCheckpoint(writerDb);
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 20));
    expect(() => {
      passiveCheckpoint(writerDb);
    }).not.toThrow();

    await Promise.all([writePromise, readPromise]);

    // Check assertions
    expect(writeErrors).toEqual([]);
    expect(readErrors).toEqual([]);
    expect(readCount).toBeGreaterThan(5);

    // Verify final state and database integrity
    const finalCount = readerDb.prepare("SELECT count(*) as count FROM events").get() as { count: number };
    expect(finalCount.count).toBe(100);

    const integrity = writerDb.pragma("integrity_check(1)") as { integrity_check: string }[];
    expect(integrity[0].integrity_check).toBe("ok");
  });
});

