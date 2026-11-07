import Database from "better-sqlite3";
import { sha256Hex } from "./crypto";

export interface AuthenticatedBusiness {
  id: string;
  name: string;
  apiKeyHash: string;
}

/**
 * Authenticates bearer token against businesses table.
 * Computes sha256 of the provided API key and checks against api_key_hash.
 * Never stores or logs the raw API key.
 */
export function authenticateBusiness(
  db: Database.Database,
  authHeader: string | null
): AuthenticatedBusiness | null {
  if (!authHeader) return null;

  const parts = authHeader.trim().split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  const rawApiKey = parts[1];
  if (!rawApiKey) return null;

  const apiKeyHash = sha256Hex(rawApiKey);

  const row = db
    .prepare("SELECT id, name, api_key_hash FROM businesses WHERE api_key_hash = ?")
    .get(apiKeyHash) as { id: string; name: string; api_key_hash: string } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    apiKeyHash: row.api_key_hash,
  };
}

