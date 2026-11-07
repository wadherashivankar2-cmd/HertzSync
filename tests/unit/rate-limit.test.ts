import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { createDatabaseConnection } from "../../src/lib/db";
import { checkRateLimit, pruneOldRateWindows } from "../../src/lib/rate-limit";
import { migrate } from "../../db/migrate";

const RL_TEST_DB = path.resolve(process.cwd(), "data/test_rl.db");

describe("Rate Limiting (Atomic SQLite Fixed-Window)", () => {
  beforeAll(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${RL_TEST_DB}${ext}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  afterAll(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${RL_TEST_DB}${ext}`;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
  });

  it("returns incrementing counts in the same window", () => {
    const db = createDatabaseConnection(RL_TEST_DB);
    migrate(db);

    const now = 1700000000000;
    const res1 = checkRateLimit(db, "key_a", now, 5);
    expect(res1.count).toBe(1);
    expect(res1.allowed).toBe(true);

    const res2 = checkRateLimit(db, "key_a", now + 1000, 5);
    expect(res2.count).toBe(2);
    expect(res2.allowed).toBe(true);

    const res3 = checkRateLimit(db, "key_a", now + 2000, 5);
    expect(res3.count).toBe(3);

    db.close();
  });

  it("resets count in a new window minute", () => {
    const db = createDatabaseConnection(RL_TEST_DB);
    const window1Time = 1700000000000;
    const window2Time = 1700000060000; // +1 minute

    const r1 = checkRateLimit(db, "key_b", window1Time, 5);
    expect(r1.count).toBe(1);

    const r2 = checkRateLimit(db, "key_b", window2Time, 5);
    expect(r2.count).toBe(1);

    db.close();
  });

  it("enforces limit and returns Retry-After", () => {
    const db = createDatabaseConnection(RL_TEST_DB);
    const now = 1700000015000; // 15 seconds into the minute
    const windowStart = Math.floor(now / 60000) * 60000;
    const expectedRetryAfter = Math.ceil((windowStart + 60000 - now) / 1000);

    for (let i = 0; i < 3; i++) {
      checkRateLimit(db, "key_limit", now, 3);
    }

    const exceeded = checkRateLimit(db, "key_limit", now, 3);
    expect(exceeded.allowed).toBe(false);
    expect(exceeded.count).toBe(4);
    expect(exceeded.retryAfterSeconds).toBe(expectedRetryAfter);

    db.close();
  });

  it("prunes windows older than 10 minutes", () => {
    const db = createDatabaseConnection(RL_TEST_DB);
    const oldTime = Date.now() - 15 * 60 * 1000; // 15 mins ago
    checkRateLimit(db, "key_old", oldTime, 100);

    const pruned = pruneOldRateWindows(db);
    expect(pruned).toBeGreaterThanOrEqual(1);

    db.close();
  });
});
