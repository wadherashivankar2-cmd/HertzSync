import Database from "better-sqlite3";
import path from "path";
import { runReconciliation } from "../src/worker/reconcile";

const dbPath = path.resolve(process.cwd(), "data/trickle.db");
const db = new Database(dbPath);
const result = runReconciliation(db);
console.log("RECONCILIATION RESULT:", JSON.stringify(result, null, 2));

const row = db.prepare("SELECT * FROM reconciliations WHERE id = ?").get(result.id);
console.log("DATABASE ROW:", JSON.stringify(row, null, 2));

