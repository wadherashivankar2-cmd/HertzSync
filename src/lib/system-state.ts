import Database from "better-sqlite3";

/**
 * Cross-process key/value store shared across processes via SQLite system_state table.
 * Used for circuit breaker state, chaos flags, recovery timestamps, etc.
 * Section 2.2, 5.6, 5.7
 */

export function setSystemState<T>(
  db: Database.Database,
  key: string,
  value: T
): void {
  const json = JSON.stringify(value);
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO system_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
  `);
  stmt.run(key, json, now);
}

export function getSystemState<T>(
  db: Database.Database,
  key: string
): { value: T; updatedAt: number } | null {
  const row = db
    .prepare("SELECT value, updated_at FROM system_state WHERE key = ?")
    .get(key) as { value: string; updated_at: number } | undefined;

  if (!row) {
    return null;
  }

  return {
    value: JSON.parse(row.value) as T,
    updatedAt: row.updated_at,
  };
}

export function deleteSystemState(db: Database.Database, key: string): void {
  db.prepare("DELETE FROM system_state WHERE key = ?").run(key);
}

