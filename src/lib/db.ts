import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getConfig } from "./config";
import { logger } from "./logger";

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export function createDatabaseConnection(customDbPath?: string): Database.Database {
  const config = getConfig();
  const dbPath = customDbPath || config.DB_PATH;

  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Section 5.9 Pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000"); // wait up to 5s for a lock instead of failing at once
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL"); // safe with WAL; durable across process crashes
  db.pragma("wal_autocheckpoint = 1000"); // SQLite default, made explicit: passive checkpoint every ~1000 pages

  // Check SQLite version (must be >= 3.35 for RETURNING clause and upsert features)
  const versionRow = db.prepare("SELECT sqlite_version() as version").get() as { version: string };
  const sqliteVersion = versionRow?.version || "0.0.0";
  logger.info(`SQLite connection established. Version: ${sqliteVersion}`, { dbPath });

  if (compareSemver(sqliteVersion, "3.35.0") < 0) {
    throw new Error(
      `FATAL: SQLite version must be 3.35.0 or newer. Found ${sqliteVersion}. Upgrade better-sqlite3.`
    );
  }

  return db;
}

export function passiveCheckpoint(db: Database.Database): void {
  // PASSIVE never blocks readers or writers. It copies what it can and returns.
  db.pragma("wal_checkpoint(PASSIVE)");
}

export function truncateCheckpoint(db: Database.Database): void {
  // Allowed only at clean shutdown (section 5.10) after worker stops writing.
  db.pragma("wal_checkpoint(TRUNCATE)");
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = createDatabaseConnection();
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

