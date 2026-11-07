import Database from "better-sqlite3";
import { logger } from "./logger";

export type AuditActor = "api" | "worker" | "admin" | "system";

/**
 * Writes an entry to the audit log.
 * Section 3 & 7.1:
 * Detail is JSON and never contains private keys, secret keys, or raw API keys.
 */
export function writeAuditLog(
  db: Database.Database,
  actor: AuditActor,
  action: string,
  detail?: Record<string, unknown>
): void {
  try {
    const at = Date.now();
    const detailJson = detail ? JSON.stringify(detail) : null;
    db.prepare(`
      INSERT INTO audit_log (at, actor, action, detail)
      VALUES (?, ?, ?, ?)
    `).run(at, actor, action, detailJson);
  } catch (err: any) {
    logger.error("Failed to write audit log entry", { error: err.message, action });
  }
}

