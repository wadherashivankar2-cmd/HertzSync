import Database from "better-sqlite3";
import { getConfig } from "./config";
import { sha256Hex } from "./crypto";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

/**
 * Derives a short, privacy-preserving key identifier from the API key hash.
 * Never stores or uses raw API keys.
 */
export function deriveRateLimitKey(apiKeyHash: string): string {
  return sha256Hex(`rl_key:${apiKeyHash}`).slice(0, 16);
}

/**
 * SQLite-backed atomic fixed-window rate limiter.
 * Section 5.8:
 * - Fixed window of 1 minute aligned to the minute: floor(now / 60000) * 60000
 * - Atomic single statement with RETURNING count
 */
export function checkRateLimit(
  db: Database.Database,
  rateLimitKey: string,
  nowMs: number = Date.now(),
  customLimit?: number
): RateLimitResult {
  const config = getConfig();
  const limit = customLimit ?? config.RATE_LIMIT_PER_MIN;

  const windowStart = Math.floor(nowMs / 60000) * 60000;
  const windowEnd = windowStart + 60000;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd - nowMs) / 1000));

  // Atomic single upsert statement
  const stmt = db.prepare(`
    INSERT INTO rate_windows (key, window_start, count)
    VALUES (?, ?, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
    RETURNING count;
  `);

  const row = stmt.get(rateLimitKey, windowStart) as { count: number };
  const count = row.count;

  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSeconds,
  };
}

/**
 * Prunes windows older than 10 minutes.
 * Clock jitter rule (Section 5.8): Pruning windows older than 10 minutes prevents
 * a backward clock step smaller than 10 minutes from reopening a pruned window.
 */
export function pruneOldRateWindows(db: Database.Database, nowMs: number = Date.now()): number {
  const threshold = nowMs - 10 * 60 * 1000;
  const result = db.prepare("DELETE FROM rate_windows WHERE window_start < ?").run(threshold);
  return result.changes;
}

