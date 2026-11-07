import Database from "better-sqlite3";

/**
 * SQLite-backed counters replacing in-memory counters.
 * Section 2.2, 3, 5.1 step 8, 8.1
 */

export function incrementCounter(
  db: Database.Database,
  name: string,
  by: number = 1
): number {
  const stmt = db.prepare(`
    INSERT INTO counters (name, value)
    VALUES (?, ?)
    ON CONFLICT (name) DO UPDATE SET value = value + ?
    RETURNING value;
  `);

  const row = stmt.get(name, by, by) as { value: number };
  return row.value;
}

export function getCounter(db: Database.Database, name: string): number {
  const row = db.prepare("SELECT value FROM counters WHERE name = ?").get(name) as
    | { value: number }
    | undefined;
  return row?.value ?? 0;
}

export function setCounter(
  db: Database.Database,
  name: string,
  value: number
): void {
  db.prepare(`
    INSERT INTO counters (name, value)
    VALUES (?, ?)
    ON CONFLICT (name) DO UPDATE SET value = ?;
  `).run(name, value, value);
}

export function getAllCounters(db: Database.Database): Record<string, number> {
  const rows = db.prepare("SELECT name, value FROM counters").all() as Array<{
    name: string;
    value: number;
  }>;
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.name] = row.value;
  }
  return result;
}

