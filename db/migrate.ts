import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export function migrate(db: Database.Database, schemaPath?: string) {
  const file = schemaPath || path.resolve(process.cwd(), "db/schema.sql");
  const sql = fs.readFileSync(file, "utf8");
  db.exec(sql);
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  const dbPath = process.env.DB_PATH || "./data/trickle.db";
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  migrate(db);
  console.log("Migration executed successfully.");
  db.close();
}

