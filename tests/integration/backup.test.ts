import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { runBackup } from "../../scripts/backup";

const TEST_SOURCE_DB = path.resolve(process.cwd(), "data/test_backup_source.db");
const TEST_BACKUP_DIR = path.resolve(process.cwd(), "data/test_backups");

describe("SQLite VACUUM INTO Backup Integration (scripts/backup.ts)", () => {
  let db: Database.Database | null = null;

  beforeAll(() => {
    // Clean up any old test files
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${TEST_SOURCE_DB}${ext}`;
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    }
    if (fs.existsSync(TEST_BACKUP_DIR)) {
      try { fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    // Initialize test source database
    db = createDatabaseConnection(TEST_SOURCE_DB);
    migrate(db);

    const now = Date.now();

    // 1. Seed business & payee
    db.prepare(`
      INSERT INTO businesses (id, name, api_key_hash, created_at)
      VALUES ('biz_backup', 'Backup Biz', 'hash_bkp', ?)
    `).run(now);

    db.prepare(`
      INSERT INTO payees (id, business_id, label, solana_address, created_at)
      VALUES ('payee_backup', 'biz_backup', 'Backup Station', '25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr', ?)
    `).run(now);

    db.prepare(`
      INSERT INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES ('dev_bkp', 'biz_backup', 'payee_backup', 'pubkey_bkp', 'active', ?)
    `).run(now);

    // 2. Seed events (3 events)
    db.prepare(`
      INSERT INTO events (id, business_id, device_id, epoch, seq, amount_lamports, occurred_at, received_at, payload_hash, signature, state)
      VALUES 
        ('dev_bkp:1:1', 'biz_backup', 'dev_bkp', 1, 1, 10000, ?, ?, 'h1', 's1', 'paid'),
        ('dev_bkp:1:2', 'biz_backup', 'dev_bkp', 1, 2, 20000, ?, ?, 'h2', 's2', 'paid'),
        ('dev_bkp:1:3', 'biz_backup', 'dev_bkp', 1, 3, 30000, ?, ?, 'h3', 's3', 'queued')
    `).run(now, now, now, now, now, now);

    // 3. Seed batches (1 batch)
    db.prepare(`
      INSERT INTO batches (id, payee_id, total_lamports, event_count, events_hash, state, created_at, updated_at)
      VALUES ('batch_bkp_01', 'payee_backup', 30000, 2, 'hash_events', 'confirmed', ?, ?)
    `).run(now, now);

    // 4. Seed reconciliations (2 reconciliation runs)
    db.prepare(`
      INSERT INTO reconciliations (id, run_at, generated, queued, batched, paid, flagged, lost, onchain_duplicates, ok)
      VALUES 
        ('rec_bkp_01', ?, 2, 0, 0, 2, 0, 0, 0, 1),
        ('rec_bkp_02', ?, 3, 1, 0, 2, 0, 0, 0, 1)
    `).run(now - 1000, now);

    db.close();
    db = null;
  });

  afterAll(() => {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
    // Clean up
    for (const ext of ["", "-wal", "-shm"]) {
      const p = `${TEST_SOURCE_DB}${ext}`;
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    }
    if (fs.existsSync(TEST_BACKUP_DIR)) {
      try { fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("creates a timestamped backup via VACUUM INTO and row counts match source database", () => {
    const backupFilePath = runBackup(TEST_SOURCE_DB, TEST_BACKUP_DIR);
    expect(fs.existsSync(backupFilePath)).toBe(true);
    expect(backupFilePath).toContain("trickle_backup_");
    expect(backupFilePath.endsWith(".db")).toBe(true);

    const sourceDb = new Database(TEST_SOURCE_DB, { readonly: true });
    const backupDb = new Database(backupFilePath, { readonly: true });

    try {
      // Check events count
      const sourceEvents = sourceDb.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };
      const backupEvents = backupDb.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };
      expect(backupEvents.count).toBe(sourceEvents.count);
      expect(backupEvents.count).toBe(3);

      // Check batches count
      const sourceBatches = sourceDb.prepare("SELECT COUNT(*) as count FROM batches").get() as { count: number };
      const backupBatches = backupDb.prepare("SELECT COUNT(*) as count FROM batches").get() as { count: number };
      expect(backupBatches.count).toBe(sourceBatches.count);
      expect(backupBatches.count).toBe(1);

      // Check reconciliations count
      const sourceReconciliations = sourceDb.prepare("SELECT COUNT(*) as count FROM reconciliations").get() as { count: number };
      const backupReconciliations = backupDb.prepare("SELECT COUNT(*) as count FROM reconciliations").get() as { count: number };
      expect(backupReconciliations.count).toBe(sourceReconciliations.count);
      expect(backupReconciliations.count).toBe(2);
    } finally {
      sourceDb.close();
      backupDb.close();
    }
  });
});
