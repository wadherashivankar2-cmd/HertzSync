CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,      -- sha256 of the API key; never store raw key
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payees (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  label TEXT NOT NULL,                    -- e.g. "Charger site 12"
  solana_address TEXT NOT NULL,           -- base58 public key, DevNet only
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  payee_id TEXT NOT NULL REFERENCES payees(id),
  public_key TEXT NOT NULL,               -- base64 Ed25519 public key
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,                    -- deviceId ":" epoch ":" seq  (idempotency key)
  business_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  epoch INTEGER NOT NULL,                 -- device identity generation; changes if device state is lost
  seq INTEGER NOT NULL,                   -- sequence within one epoch, starts at 1
  amount_lamports INTEGER NOT NULL CHECK (amount_lamports > 0),
  occurred_at INTEGER NOT NULL,           -- device timestamp, unix ms
  received_at INTEGER NOT NULL,           -- server timestamp, unix ms
  payload_hash TEXT NOT NULL,             -- sha256 of canonical payload
  signature TEXT NOT NULL,                -- base64 Ed25519 signature
  state TEXT NOT NULL CHECK (state IN ('queued','batched','paid','flagged')),
  batch_id TEXT,
  UNIQUE (device_id, epoch, seq)
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,                    -- ULID (26 chars, time sortable)
  payee_id TEXT NOT NULL REFERENCES payees(id),
  total_lamports INTEGER NOT NULL,
  event_count INTEGER NOT NULL,
  events_hash TEXT NOT NULL,              -- sha256 of sorted event IDs joined by "\n"
  state TEXT NOT NULL CHECK (state IN
    ('built','submitted','retrying','confirmed','expired_rebuilt','failed_review')),
  signature TEXT,                         -- current Solana signature
  serialized_tx TEXT,                     -- base64 signed tx, kept for safe resubmission
  last_valid_block_height INTEGER,        -- from the blockhash used to sign THIS tx
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,                  -- e.g. 'events_received_total', 'generated_by_ingest'
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,                   -- e.g. 'breaker:https://...', 'chaos:https://...'
  value TEXT NOT NULL,                    -- JSON
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_windows (
  key TEXT NOT NULL,                      -- short id derived from API key hash, never raw key
  window_start INTEGER NOT NULL,          -- unix ms, aligned to the minute
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE IF NOT EXISTS latency_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,                     -- 'ingest' or 'confirmation'
  ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliations (
  id TEXT PRIMARY KEY,
  run_at INTEGER NOT NULL,
  generated INTEGER NOT NULL,
  queued INTEGER NOT NULL,
  batched INTEGER NOT NULL,
  paid INTEGER NOT NULL,
  flagged INTEGER NOT NULL,
  lost INTEGER NOT NULL,                  -- must be 0
  onchain_duplicates INTEGER NOT NULL,    -- must be 0
  ok INTEGER NOT NULL CHECK (ok IN (0,1))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,                    -- 'api', 'worker', 'admin', 'system'
  action TEXT NOT NULL,
  detail TEXT                             -- JSON, never contains keys or raw API keys
);

CREATE INDEX IF NOT EXISTS idx_events_state ON events(state);
CREATE INDEX IF NOT EXISTS idx_events_device ON events(device_id);
CREATE INDEX IF NOT EXISTS idx_batches_state ON batches(state);
CREATE INDEX IF NOT EXISTS idx_latency_kind_at ON latency_samples(kind, at);

