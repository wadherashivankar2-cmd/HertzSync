# TrickleSettle: Build Blueprint

**One-line:** TrickleSettle is a reliability layer between a business's device or usage events and Solana DevNet. It queues events durably, pays in batches, survives outages, and proves every payment reconciles.

**Positioning:** Middle layer for businesses, not a standalone consumer app. Business customers send usage events through an API. TrickleSettle handles queuing, batching, retries, RPC failover, and reconciliation.

**Deployment model (explicit):** Single host (local machine or one VM). Two long-running processes: the Next.js server and the settlement worker. Both share one SQLite file. This is NOT a serverless design. Do not deploy the worker to serverless functions. Any state shared between the two processes must live in SQLite, never in process memory.

---

## 0. How the AI coder must use this file

1. Read this whole file once at the start. Do not write code yet.
2. Read `PROGRESS.md` (create it in Phase 0 if missing). It records which phases are complete.
3. When the user says **"go"**, execute only the next incomplete phase. Never start two phases in one "go".
4. Use the model named in the phase header. Do not switch models mid-phase.
5. Model switching rule: if a Medium or Low phase fails its tests twice, stop, switch to Gemini 3.8 High, re-run the phase from its last passing gate, and record the switch in `PROGRESS.md`. Never use Low for a High phase.
6. Each phase ends with a **GATE**. At the gate:
   - Run the phase's tests and show the real output.
   - Update `PROGRESS.md` and `TESTS.md`.
   - Print the phase report (section 16).
   - Stop and wait for the user's next "go".
7. If any test fails, stop, report the failure with the exact output, and propose a fix. Do not mark the phase complete.
8. Never fake results. Never write a test that always passes. Never mark a checkbox you did not verify.
9. Never use mainnet. Never print, commit, or log private keys. Keys live only in `.env.local` or `keys/`, both gitignored.
10. Never add features outside the phase, and never add features not in this file. If something seems missing, write it in `PROGRESS.md` under "Suggestions" and do not implement it.
11. If a Solana API, limit, or constant is uncertain, check the official Solana docs before coding it. Note the source in a code comment. Never guess a constant.
12. Never keep process-local state that another process needs. Use the SQLite tables defined in section 3.
13. Never use `PRAGMA wal_checkpoint(TRUNCATE)` while the app is running. Only `PASSIVE` checkpoints are allowed during operation.

### 0.1 Model assignment summary

| Phase | Name | Model | Why |
|---|---|---|---|
| 0 | Setup and guardrails | Gemini 3.8 Low | Scaffolding and config; low risk |
| 1 | Database and shared state | Gemini 3.8 Medium | Schema and state rules; must be exact |
| 2 | Ingest API and security | Gemini 3.8 High | Signatures, idempotency, conflicts, rate limits |
| 3 | Solana integration and RPC router | Gemini 3.8 High | Transactions, failover, chain verification |
| 4 | Settlement worker, recovery, shutdown | Gemini 3.8 High | Money-moving retry logic and crash safety |
| 5 | Device simulator | Gemini 3.8 Medium | Scripting; correctness checked by tests |
| 6 | Operator console (dashboard) | Gemini 3.8 Medium | UI logic; visual polish reviewed by user |
| 7 | Metrics and observability | Gemini 3.8 Medium | Reads and aggregates existing data |
| 8 | Full test and security hardening | Gemini 3.8 High | Proves safety; must not hide failures |
| 9 | Documentation and demo | Gemini 3.8 Low | Writing and clean-clone checks |
| 10 | Final Definition of Done | Gemini 3.8 Medium | Evidence gathering; must be accurate |

---

## 1. Product specification

### 1.1 Problem

DePIN businesses (EV charging networks, hotspot networks, sensor networks, usage-based APIs) produce many small usage events. Each event may need a small payment on Solana. When the network or RPC provider fails:
- Events are lost, so payees are underpaid.
- Retries pay the same event twice, so payers are overcharged.
- A device that loses its local state can silently overwrite or drop new events.
- Recovery needs manual work, so operators lose hours.
- Developers have no way to prove that payments match events.

### 1.2 Users

| User | What they do | What they need |
|---|---|---|
| Business (customer of TrickleSettle) | Sends usage events through API | Reliable settlement, status per event, reconciliation |
| Operator (business's payee) | Receives payments | Proof that earnings are complete and correct |
| Device (simulated) | Generates signed usage events | Events accepted even when the chain is down; safe recovery after losing local state |
| Judge / reviewer | Watches the demo | Understands the value in 90 seconds, with no wallet setup |

### 1.3 Core promises

1. **Nothing lost:** every accepted event reaches a terminal state (paid or flagged). A device reset never causes a new event to be dropped.
2. **Nothing paid twice:** each event appears in at most one confirmed batch on-chain.
3. **Conflicts are visible:** the same event key with different content is rejected loudly (409), never silently accepted or overwritten.
4. **Failures stay isolated:** a chain or RPC outage never stops event intake.
5. **Automatic recovery:** after the network returns, pending work completes without manual action.
6. **Safe interruption:** stopping either process at any moment, including a forced kill, never loses or double-pays an event. A graceful stop is preferred but not required for safety.
7. **Provable:** every batch has a Solana signature, a memo with its batch ID and event-set hash, and a reconciliation record.

### 1.4 Non-goals (do not build)

- Mainnet support of any kind.
- Real money or real custody.
- Sybil resistance (preventing fake devices from earning).
- Token issuance, staking, or rewards.
- Per-user Phantom signing for payments (Phantom is read-only: connect and show balance).
- Serverless deployment.
- Mobile apps, user accounts beyond business API keys, email, or fiat payments.
- Audits or compliance certifications (document their absence instead).

---

## 2. Architecture

### 2.1 Components

```
 Business system / Device simulator
            |  POST /api/v1/events (API key + Ed25519 signature)
            v
 +-----------------------+
 |  Ingest API           |  validates, rate-limits, deduplicates, enqueues
 |  (Next.js process)    |  never calls Solana
 +-----------------------+
            |
            v
 +-----------------------+
 |  SQLite (single file) |  shared by both processes: businesses, devices,
 |  WAL mode             |  events, batches, counters, system_state,
 |                       |  rate_windows, reconciliations, audit_log
 +-----------------------+
            ^
            |  reads queued events, writes batch state, reads chaos flags
 +-----------------------+        +--------------------------+
 |  Settlement worker    | -----> |  Solana DevNet via       |
 |  (separate process)   |        |  RPC router (failover,   |
 |  batch, sign, submit, |        |  circuit breaker state   |
 |  retry, reconcile     |        |  stored in SQLite)       |
 +-----------------------+        +--------------------------+
            |
            v
 +-----------------------+
 |  Operator console     |  dashboard, metrics, reconciliation,
 |  (Next.js pages)      |  chaos toggles (dev only), reads SQLite only
 +-----------------------+
```

### 2.2 Failure isolation rules

- Ingest never waits on Solana. It writes to SQLite and returns.
- The worker is a separate process. If it crashes, ingest keeps accepting events.
- The RPC router is the only module that talks to Solana. If it fails, the worker marks batches as retrying and does nothing else.
- The dashboard reads from SQLite only. It works during a chain outage.
- Each external call has a timeout. No call waits forever.
- **Cross-process state rule:** the circuit breaker state, chaos flags, counters, and rate-limit windows all live in SQLite. The app and worker never rely on each other's memory.
- **Interruption rule:** every state change is written to SQLite before the matching external action. A process can be killed at any line and restart safely (section 5.10).

### 2.3 Repository layout

```
trickle-settle/
  BLUEPRINT.md
  PROGRESS.md
  TESTS.md
  README.md
  SECURITY.md
  KNOWN_LIMITS.md
  .env.example
  .gitignore
  package.json
  tsconfig.json
  vitest.config.ts
  db/
    schema.sql
    migrate.ts
  src/
    lib/
      config.ts          (env parsing with zod, devnet guard)
      db.ts              (SQLite connection, pragmas, checkpoint helper)
      canonical.ts       (canonical event serialization)
      crypto.ts          (Ed25519 verify, sha256 helpers)
      money.ts           (integer lamport math)
      ids.ts             (ULID generation, memo builder with length check)
      rpc-router.ts      (endpoint list, failover, circuit breaker, reads state from SQLite)
      solana.ts          (transfer + memo builders, status checks, fresh blockhash)
      state.ts           (event and batch state machines)
      counters.ts        (counter increment and read, backed by SQLite)
      system-state.ts    (key/value state shared across processes: breaker, chaos)
      rate-limit.ts      (fixed-window limiter, atomic upsert on SQLite rate_windows)
      metrics.ts         (metric reads, latency samples, percentiles)
      logger.ts          (structured JSON logs, key redaction)
      chaos.ts           (dev-only fault flags, read by router via system-state)
      lifecycle.ts       (signal handling, shutdown flag, grace timer, clean close)
    worker/
      index.ts           (worker loop, startup resume, graceful shutdown)
      batcher.ts         (grouping events into batches)
      settle.ts          (fresh blockhash, submit, retry, reconcile)
    app/
      api/v1/events/route.ts
      api/v1/events/[id]/route.ts
      api/v1/batches/route.ts
      api/v1/metrics/route.ts
      api/v1/reconciliation/route.ts
      api/v1/chaos/route.ts
      page.tsx           (operator console)
      layout.tsx
      globals.css
    components/
      MetricCard.tsx
      FlowDiagram.tsx
      BatchTable.tsx
      ReconciliationPanel.tsx
      EndpointPanel.tsx
      ChaosControls.tsx
      EventLog.tsx
      StatusBadge.tsx
  scripts/
    seed.ts              (creates demo business, devices, payees)
    device-sim.ts        (generates signed events; normal, burst, offline, reset modes)
    keygen.ts            (creates treasury keypair file, prints only public key)
    report.ts            (plain-English run summary)
  tests/
    unit/
    integration/
    chaos/
    security/
    load/
    e2e/
```

### 2.4 Tech stack and deployment

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router), TypeScript | Preferred stack; API routes and UI in one repo |
| Styling | Tailwind CSS | Preferred stack |
| Database | SQLite via `better-sqlite3` | Durable, zero infrastructure, single file shared by two processes in WAL mode |
| Validation | `zod` | Schema validation on every input |
| Solana | `@solana/web3.js` (1.x line) | Stable, well-documented, includes Memo and transfer helpers |
| Device signatures | `tweetnacl` | Ed25519, small and stable |
| Tests | `vitest` | Fast, TypeScript-native |
| Security scan | `npm audit` | Built in |
| Process management | Two terminals, or PM2 on one machine | Keeps the two processes alive |

**Deployment:** Run `npm run start` (Next.js) and `npm run worker` as two separate processes on the same host. Both point at the same `DB_PATH`. Do not deploy to serverless platforms.

Do not add Rust, Anchor, AI models, or extra services. If `better-sqlite3` fails to install, stop and report. Do not switch databases without approval.

---

## 3. Data model

Write this to `db/schema.sql` in Phase 1.

```sql
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
```

**Notes:**
- `events.id` is `deviceId:epoch:seq`. The `UNIQUE (device_id, epoch, seq)` constraint is the second guard.
- `counters` replaces in-memory counters. Every counter increment happens in the same SQLite transaction as the change it counts.
- `system_state` is how the app and worker share breaker state and chaos flags.

---

## 4. State machines

### 4.1 Event states

```
queued ──(included in batch)──> batched ──(batch confirmed)──> paid
   │                                 │
   └──(validation fails later)──> flagged <──(batch failed_review)
```

- `queued`: accepted and durable. Never removed.
- `batched`: assigned to a batch that is not yet confirmed.
- `paid`: its batch is confirmed on Solana.
- `flagged`: needs human review. Never auto-retried.

Rule: an event only moves forward. `paid` and `flagged` are terminal for automation.

### 4.2 Batch states

```
built ──> submitted ──> confirmed
              │
              ├──> retrying ──> submitted (same signed tx, if not expired)
              │        │
              │        └──> expired_rebuilt ──> submitted (new tx, same batch ID)
              │
              └──> failed_review  (after max attempts or unrecoverable error)
```

Rule: a batch is `confirmed` only after `getSignatureStatuses` reports confirmed or finalized for its signature.

---

## 5. Core algorithms

### 5.1 Event acceptance (ingest)

1. Authenticate the API key (hash it, look up the business). Unknown key: **401**.
2. Apply the rate limit (section 5.8). Exceeded: **429** with `Retry-After`.
3. Parse body with zod: `deviceId`, `epoch` (positive integer), `seq` (positive integer), `amountLamports` (positive integer, at most `MAX_EVENT_LAMPORTS`), `occurredAt` (unix ms), `signature` (base64). Invalid: **400**.
4. Confirm the device belongs to this business and is `active`. Otherwise **403**.
5. Build the canonical payload with fixed key order and no whitespace:
   `{"amountLamports":..,"businessId":"..","deviceId":"..","epoch":..,"occurredAt":..,"seq":..}`
6. Verify the Ed25519 signature over the canonical payload with the device's public key. Invalid: **401**, audit log entry.
7. Compute `payload_hash = sha256(canonical payload)`. Compute `id = deviceId:epoch:seq`.
8. In one SQLite transaction:
   - Try to insert the event with `state='queued'` and increment `events_received_total` and `generated_by_ingest`.
   - If the insert hits `UNIQUE (device_id, epoch, seq)`:
     - Load the existing row.
     - Same `payload_hash`: retransmission. Return **200** with `duplicate: true` and the existing state. Increment `events_duplicate_total`.
     - Different `payload_hash`: conflict. Do not overwrite. Return **409** with `code: "event_conflict"`. Write an audit entry and increment `events_conflict_total`.
9. Return **202** with the event ID and state. Ingest never calls Solana.

**Device epoch rule:** A device stores `epoch` and `seq` in its own state file. If that file is lost, the device generates a new epoch (a random positive integer or a boot timestamp) and starts `seq` at 1 again. The server accepts a new epoch from an active device and writes an audit entry, "new epoch registered." Old and new events cannot collide because the epoch differs.

### 5.2 Batching (worker)

Runs every `BATCH_INTERVAL_MS` (default 5000) and whenever the queue exceeds `BATCH_MAX_EVENTS`.

1. Select queued events grouped by payee, oldest first, up to `BATCH_MAX_EVENTS` per payee.
2. Compute `total_lamports` as an integer sum. If it exceeds `MAX_BATCH_LAMPORTS`, split the group.
3. Compute `events_hash = sha256(sorted event IDs joined by "\n")`.
4. Generate a ULID for the batch ID.
5. In one SQLite transaction, insert the batch with `state='built'` and move its events to `batched`.
6. Continue to submission (5.3). Do not fetch a blockhash here.

### 5.3 Submission with fresh blockhash

1. Check the treasury balance against `TREASURY_MIN_LAMPORTS` (S14). Below threshold: do not send. Log the reason in plain language.
2. **Fetch a fresh blockhash immediately before signing.** Read `getLatestBlockhash` (or the equivalent in the Solana SDK version pinned in `package.json`) inside this function. Never reuse a blockhash stored at batch creation or from a previous attempt. Check the Solana docs for the current blockhash validity window and note it in a code comment.
3. Build one transaction containing:
   - A transfer from the treasury wallet to the payee for `total_lamports`.
   - A Memo instruction with the text `trickle:v1:<batchId>:<eventsHash>`.
4. Validate the memo length with `ids.ts` before signing. The limit is `MEMO_MAX_BYTES = 120`. Over the limit: set the batch to `failed_review` with a clear error. Do not send.
5. Sign with the treasury key. Store `serialized_tx`, `signature`, and `last_valid_block_height` (from the blockhash used in step 2) in SQLite **before** sending.
6. Send via the RPC router. Set state to `submitted`.
7. Poll `getSignatureStatuses` until confirmed or until timeout.
8. Confirmed: set the batch `confirmed` and its events `paid`. Record confirmation latency in `latency_samples`.

### 5.4 Retry rules (critical: prevents double pay)

When a batch is `submitted` but not confirmed after the timeout:

1. Query the signature status on two different RPC endpoints.
2. If either reports confirmed or finalized: mark `confirmed`. Do not resend.
3. If the signature is not found and the current block height is at or below `last_valid_block_height`: resend the **same** `serialized_tx`. Only one copy can land, so this is safe. Increment `attempts`.
4. If the signature is not found and the current block height is above `last_valid_block_height`: the original transaction has expired and cannot land. Only now rebuild with a **fresh blockhash** (per 5.3 step 2), keep the same batch ID and events hash, set state `expired_rebuilt`, then `submitted`.
5. Never rebuild a batch whose original signature might still land. Always run step 4's check first.
6. After `MAX_ATTEMPTS` (default 5): set `failed_review`, move events to `flagged`, and write an audit entry.

### 5.5 Reconciliation

Runs on worker startup and every `RECONCILE_INTERVAL_MS`:

1. Count events by state. Compute `accounted = queued + batched + paid + flagged`.
2. `lost = counters.generated_by_ingest - accounted`. The `generated_by_ingest` counter is incremented in the same transaction as each event insert (5.1 step 8), so this is a real comparison and not a tautology.
3. `onchain_duplicates`: for each confirmed batch, fetch its transaction memo and confirm it matches `trickle:v1:<batchId>:<eventsHash>` for the stored batch. Recompute `eventsHash` from the stored event IDs and compare. Also confirm no event ID appears in two confirmed batches.
4. Write a row to `reconciliations`. Set `ok = 1` only if `lost = 0` and `onchain_duplicates = 0`.
5. Run a passive WAL checkpoint (section 5.9). Never `TRUNCATE`.

### 5.6 RPC router with failover and circuit breaker

- Configure `RPC_ENDPOINTS` as a comma-separated list. Require at least 2 for the failover demo.
- Breaker state for each endpoint is stored in `system_state` under the key `breaker:<url>`, so the worker writes it and the dashboard reads it. Values: `closed` (healthy), `open` (failing; skipped), `half_open` (testing).
- An endpoint opens after `CB_FAILURE_THRESHOLD` (default 3) consecutive failures. It stays open for `CB_COOLDOWN_MS` (default 30000).
- Each request has `RPC_TIMEOUT_MS` (default 8000).
- **Chaos flags** are read from `system_state` key `chaos:<url>` before every call. If the flag says `down`, the call fails immediately as if the endpoint were offline. If it says `timeout`, the call waits `RPC_TIMEOUT_MS` then fails. If it says `429`, the call fails with a rate-limit error. If it says `lie`, see 5.7.
- If all endpoints are open, the worker waits and retries. It does not crash.
- On startup, verify the cluster by comparing `getGenesisHash` to the known DevNet genesis hash. Look up the value in the Solana docs and record it in `config.ts` with a source comment. Mismatch: refuse to start.

### 5.7 Chaos injection (dev only)

- `POST /api/v1/chaos` with `{ "endpoint": "<url>", "mode": "off" | "down" | "timeout" | "429" | "lie" }`.
- Writes to `system_state` key `chaos:<url>`. The worker reads this flag on every RPC call (5.6), which is how a dashboard click reaches the worker process.
- Only active when `CHAOS_ENABLED=true` and `NODE_ENV !== "production"`. Otherwise returns **404**.
- `lie` mode returns a fabricated "confirmed" status from one endpoint. The router must catch this by cross-checking the second endpoint before marking anything confirmed.

### 5.8 Rate limiting (SQLite-backed, atomic)

- Fixed window of one minute per API key.
- Compute `window_start = floor(now / 60000) * 60000` using wall-clock time (the window must be shared across processes, so monotonic clocks are not used).
- Increment with a **single atomic statement**, run as the only statement in its own transaction:

```sql
INSERT INTO rate_windows (key, window_start, count)
VALUES (?, ?, 1)
ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
RETURNING count;
```

  This needs SQLite 3.35 or newer, which `better-sqlite3` bundles. Confirm the bundled version in Phase 1 with `SELECT sqlite_version()`. Do not use a separate `INSERT OR IGNORE` followed by an `UPDATE`.
- If the returned `count > RATE_LIMIT_PER_MIN`, return 429 with `Retry-After` set to seconds until the window ends.
- The key used in `rate_windows` is a short id derived from the API key hash, never the raw key.
- **Clock jitter rule:** the worker prunes windows older than 10 minutes, never sooner. A backward clock step smaller than 10 minutes therefore cannot reopen a pruned window. A larger step is logged as a warning in the audit log by comparing `Date.now()` with the last recorded window start.
- The worker prunes old windows once per reconciliation cycle.
- Default `RATE_LIMIT_PER_MIN=600`. The load test sets its own higher value in its environment file. Do not hardcode a larger default for production runs.

### 5.9 SQLite connection rules and checkpointing

Applied in `src/lib/db.ts` on every connection, in both processes:

```ts
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');     // wait up to 5s for a lock instead of failing at once
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');    // safe with WAL; durable across process crashes
db.pragma('wal_autocheckpoint = 1000'); // SQLite default, made explicit: passive checkpoint every ~1000 pages
```

**Checkpoint rules:**
- SQLite runs passive auto-checkpoints by default. This keeps the `-wal` file bounded under normal load.
- The worker calls `db.pragma('wal_checkpoint(PASSIVE)')` once per reconciliation cycle. `PASSIVE` never blocks readers or writers. It copies what it can and returns.
- `TRUNCATE` and `RESTART` are not allowed while the app is running. They wait for readers, which can stall the dashboard during a burst.
- `TRUNCATE` is allowed only at clean shutdown (section 5.10), after the worker has stopped writing.
- During the burst test, record the size of the `-wal` file before and after in `TESTS.md`.

**Other rules:**
- Every multi-row change uses a transaction (`db.transaction(...)`).
- Writes stay short. No network calls inside a SQLite transaction.
- `SQLITE_BUSY` after the timeout is an error. Log it, return 500 at the API, and let the worker retry on its next loop.

### 5.10 Graceful shutdown (worker and app)

**Goal:** a stop request never leaves a half-finished write or an orphaned external action. A forced kill must also be safe, because the rest of the design (resume on startup, state written before send) covers it.

**Signals:** both processes listen for `SIGINT` and `SIGTERM` through `src/lib/lifecycle.ts`.

**Behaviour on the first signal:**
1. Set `isShuttingDown = true`. Log: "Stop requested. Finishing the current step."
2. The worker loop checks this flag between steps, never in the middle of one. It does not start a new batch, a new submission, or a new reconciliation.
3. Any SQLite transaction already open is allowed to finish. Any batch in `submitted` or `retrying` stays in that state. Its `serialized_tx` and `signature` are already stored (5.3 step 5), so the next startup resumes it.
4. Start a grace timer of `SHUTDOWN_GRACE_MS` (default 10000). When the loop is idle, or the timer fires, continue to step 5.
5. Run `PRAGMA wal_checkpoint(TRUNCATE)` once (safe here, because the worker has stopped writing), then `db.close()`, then exit with code 0.
6. The app process stops accepting new requests, waits for in-flight requests up to the grace timer, closes the database, and exits with code 0.

**Behaviour on a second signal:** exit immediately with code 1, skipping the checkpoint. The state is still safe, because startup resume covers it.

**Startup after any stop (graceful or forced):**
1. Open the database and run `PRAGMA integrity_check` (quick mode). Failure: refuse to start and log the error.
2. Resume every batch in `submitted` or `retrying` before creating new batches (section 5.4 applies).
3. Run reconciliation once.

**Rules:**
- Shutdown code never performs an external action (no sends, no new RPC writes).
- Shutdown never deletes rows.
- Tests simulate both paths: graceful stop and forced kill.

---

## 6. API specification

All responses are JSON. All routes are under `/api/v1`. Business routes use `Authorization: Bearer <api_key>`.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/events` | Submit one signed usage event | Business key |
| GET | `/events/:id` | Status of one event | Business key |
| GET | `/batches` | List batches for the business | Business key |
| GET | `/reconciliation` | Latest reconciliation result | Business key |
| GET | `/metrics` | Counters, latencies, endpoint states | Business key |
| POST | `/chaos` | Inject faults (dev only) | Admin key |

### 6.1 POST /events request body

```json
{
  "deviceId": "dev_001",
  "epoch": 1767225600,
  "seq": 42,
  "amountLamports": 50000,
  "occurredAt": 1767225600000,
  "signature": "base64-ed25519-signature"
}
```

### 6.2 Response codes

| Code | Meaning |
|---|---|
| 202 | Accepted and queued |
| 200 | Duplicate (same content); returns existing event |
| 400 | Schema invalid |
| 401 | Unknown key or bad signature |
| 403 | Device not owned by business or revoked |
| 404 | Not found, or chaos route disabled |
| 409 | Event conflict: same device, epoch, and seq with different content. Not stored. |
| 429 | Rate limited |
| 500 | Internal error (never leaks stack traces) |

Error body: `{ "error": { "code": "...", "message": "..." } }`. No internal details.

---

## 7. Security specification

### 7.1 Threats and controls

| # | Threat | Control | Test |
|---|---|---|---|
| S1 | Replayed event (double counting) | Unique key `(device_id, epoch, seq)`; same content returns 200 duplicate, stored once | Send same event 100 times; exactly 1 row |
| S2 | Forged event | Ed25519 verification over canonical payload | Altered amount rejected with 401 |
| S3 | Event from another business's device | Ownership check on device | Business B using A's device gets 403 |
| S4 | Mainnet used by accident | Genesis hash check and `CLUSTER=devnet` required | Start with mainnet config; process refuses to start |
| S5 | Key leakage | Keys only in env file or `keys/`; logger redacts fields named key, secret, private; keys never in API responses | Grep build output and logs for key bytes; zero hits |
| S6 | API key stored in plaintext | Store SHA-256 hash only | DB dump contains no raw key |
| S7 | Oversized or abusive amounts | Max per event and max per batch enforced server side | Over-limit event rejected |
| S8 | Duplicate payment on retry | Retry rules in 5.4; resend identical signed tx only; fresh blockhash only after expiry | Kill worker mid-batch; on-chain duplicates = 0 |
| S9 | Single lying RPC | Cross-check status on 2 endpoints before confirming | Chaos `lie` mode; app still reports truth |
| S10 | API flooding | Atomic SQLite fixed-window limit per key (5.8) | Burst beyond limit returns 429 |
| S11 | Malformed input | zod schemas on every route | Table of 30 bad payloads; all 400 |
| S12 | Vulnerable dependencies | `npm audit --omit=dev` | Zero high or critical unresolved; exceptions in SECURITY.md |
| S13 | Chaos routes in production | Double guard: env flag and NODE_ENV | With NODE_ENV=production, route returns 404 |
| S14 | Treasury drained by bug | Balance check before each batch against `TREASURY_MIN_LAMPORTS` | Empty treasury test: nothing sent |
| S15 | Dev log leaks | Structured logs with redaction; no stack traces in API responses | Log scan test |
| S16 | Device reset drops new events | Epoch in event key; new epoch accepted; same key with different content returns 409 | Reset device state, send seq 1 under new epoch: accepted, not dropped |
| S17 | Conflicting content silently accepted | Payload hash compared on duplicate; mismatch returns 409 and audit entry | Same key, altered amount: 409, original row unchanged |
| S18 | Memo bloat or malformed memo | Memo length validated before signing (`MEMO_MAX_BYTES`) | Oversized memo: batch refused before send |
| S19 | Cross-process state drift | All shared state in SQLite (5.6, 5.7, 5.8) | Chaos click in app affects worker router in integration test |
| S20 | Interrupted shutdown causes loss or double pay | State written before every external action; graceful and forced stop both resume safely (5.10) | Stop worker during submit with SIGINT, then with SIGKILL; restart; reconciliation shows lost = 0 and on-chain duplicates = 0 |

### 7.2 SECURITY.md contents

- Threat table above, with status per row.
- Explicit statement: DevNet prototype. Not audited. Not for real funds.
- Key handling and how to rotate the DevNet treasury key.
- Deployment statement: single host only.
- Shutdown and restart behaviour (5.10), in plain language.
- Disclosure contact placeholder.

---

## 8. Metrics specification

### 8.1 Metrics (exposed at `/api/v1/metrics` and shown on the dashboard)

All counters live in the `counters` table. Latency samples live in `latency_samples`. No value is held only in process memory.

| Metric | Definition | Target |
|---|---|---|
| `events_received_total` | Accepted events | Live |
| `events_duplicate_total` | Same-content retransmissions | Live |
| `events_conflict_total` | 409 conflicts | Live |
| `events_rejected_total` | Failed validation or signature | Live |
| `generated_by_ingest` | Events inserted (basis for lost check) | Live |
| `events_queued` | Currently queued | Rises during outage, falls after recovery |
| `events_paid` | Confirmed on-chain | Equals received minus open |
| `events_lost` | From reconciliation | **0** |
| `onchain_duplicates` | From reconciliation | **0** |
| `batches_confirmed_total` | Confirmed batches | Live |
| `batch_retries_total` | Resubmissions | Live |
| `batches_expired_rebuilt_total` | Rebuilt after expiry | Live |
| `recovery_seconds_last` | Endpoint restore to queue empty | Recorded per outage test |
| `confirmation_p50_ms` / `p95_ms` | Batch submit to confirmation | Measured on DevNet |
| `ingest_p95_ms` | Ingest latency | Target under 100 ms locally |
| `rpc_endpoint_state` | closed / open / half_open per endpoint | Live |
| `wal_size_bytes` | Size of the `-wal` file | Recorded during burst test; stays bounded |
| `fees_paid_lamports` | Sum of transaction fees | Live |

### 8.2 Rules

- Every number displayed comes from SQLite. No hardcoded values.
- Record real test-run numbers in `TESTS.md`. Never estimate.

---

## 9. Design system

### 9.1 Principles

- Calm and trustworthy, like a banking app, not a crypto casino.
- Explain every state in words. Color is never the only signal.
- A non-technical judge should understand the screen without a presenter.

### 9.2 Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0F172A` | Page background |
| `--surface` | `#1E293B` | Cards |
| `--text` | `#F1F5F9` | Primary text |
| `--muted` | `#94A3B8` | Secondary text |
| `--accent` | `#14B8A6` | Paid, healthy, primary buttons |
| `--pending` | `#F59E0B` | Waiting, retrying |
| `--failed` | `#EF4444` | Failed, flagged, conflict, endpoint down |
| `--info` | `#38BDF8` | Links, Explorer references |

Font: Inter, fallback `system-ui`. IDs and signatures in `ui-monospace`.

### 9.3 Status labels (plain language)

| Internal state | Shown as | Color | Tooltip |
|---|---|---|---|
| queued | Waiting to be paid | pending | "Recorded safely. Will be paid when the network is available." |
| batched | Being paid | pending | "Grouped into a payment that is on its way." |
| paid | Paid on Solana | accent | "Confirmed on the Solana test network." |
| flagged | Needs review | failed | "Could not be paid automatically. A person should check it." |
| retrying | Retrying | pending | "The network did not confirm yet. Trying again safely." |
| conflict | Conflicting record | failed | "A different record with the same ID arrived. The original was kept." |

### 9.4 Layout

- Header: product name, cluster badge ("DevNet test network"), live status dot.
- Row 1: four metric cards (Received, Waiting, Paid, Lost = 0 with a check).
- Row 2: flow diagram with three nodes (Devices → Recorded safely → Paid on Solana). Animated dots show movement. The chain segment pauses when the chain is down; the Recorded node keeps animating.
- Row 3: Endpoint panel (each RPC with state badge) and chaos controls.
- Row 4: Batch table: Batch, Payee, Events, Amount (SOL), State, Explorer link.
- Row 5: Reconciliation panel with a large OK or NOT OK indicator and the equation generated = paid + waiting + needs review.
- Bottom: event log (latest 50 lines, plain language).
- Under 640px: cards stack, flow becomes vertical, table scrolls inside its own container.

### 9.5 Motion

- Counters animate on change.
- Flow dots: CSS only, disabled under `prefers-reduced-motion`.
- Recovery "drain" animation on the queue counter.

### 9.6 Accessibility

- Body text contrast at least 4.5:1.
- Every icon has a text label or aria-label.
- Visible keyboard focus on all buttons.

---

## 10. Phases

Each phase lists the **Model**, **Goal**, **Build**, **Acceptance**, **Tests**, and a **GATE**. Do not skip items.

---

### Phase 0: Setup and guardrails

**Model:** Gemini 3.8 Low

**Goal:** A clean, runnable project with safety rails before business logic.

**Build:**
1. Create the repository layout from section 2.3.
2. Initialize Next.js (App Router, TypeScript, Tailwind). Install: `better-sqlite3`, `zod`, `@solana/web3.js`, `tweetnacl`, `vitest`.
3. Create `.gitignore`: `node_modules`, `.env.local`, `*.db`, `*.db-wal`, `*.db-shm`, `keys/`, `.next`, `data/`.
4. Create `.env.example` with every variable from section 11.
5. Create `src/lib/config.ts`:
   - Parse env with zod.
   - Require `CLUSTER=devnet`. Any other value throws at startup.
   - Expose `DEVNET_GENESIS_HASH` as a constant with a source comment. Look it up in the Solana docs; do not guess.
6. Create `src/lib/logger.ts`: JSON output, key redaction.
7. Create `PROGRESS.md` and `TESTS.md` with headers only.
8. Create `README.md`: project name, one-line description, "DevNet only" banner, and a "single host deployment" note.

**Acceptance:**
- `npm run dev` starts and shows a placeholder page.
- `CLUSTER=mainnet-beta` makes config throw with a clear message.
- `.gitignore` covers all secret and database paths.

**Tests (`tests/unit/config.test.ts`):**
- Valid devnet config parses.
- Mainnet config throws.
- Missing required variable throws.

**GATE:** Run `npm test` and `npm run build`. Show output. Update `PROGRESS.md`. Stop and wait for "go".

---

### Phase 1: Database and shared state foundation

**Model:** Gemini 3.8 Medium

**Goal:** Durable storage shared safely by two processes.

**Build:**
1. Write `db/schema.sql` exactly as in section 3.
2. Write `db/migrate.ts`: applies the schema idempotently.
3. Create `src/lib/db.ts`: open `DB_PATH`, apply the pragmas in section 5.9, export a singleton, and expose a `passiveCheckpoint()` helper. Each process gets its own connection. Log the SQLite version (`SELECT sqlite_version()`) and fail startup if it is below 3.35.
4. Create `src/lib/money.ts`: integer lamport helpers (add, sum, format to SOL with 9 decimals, reject non-integers and negatives).
5. Create `src/lib/state.ts`: event and batch transition functions that reject illegal moves (for example `paid → queued` throws).
6. Create `src/lib/counters.ts` and `src/lib/system-state.ts`: read and write helpers, each operation in a transaction.
7. Create `src/lib/ids.ts`: ULID generator and memo builder with the `MEMO_MAX_BYTES` check.
8. Create `scripts/seed.ts`: one demo business, two payees, three devices with real Ed25519 public keys. Store the device private keys in `keys/devices/*.json` (gitignored). Store the API key only as a hash.

**Acceptance:**
- Running migrate twice causes no error.
- Illegal state transitions throw.
- Seed creates the expected rows; the API key is stored only as a hash.
- `PRAGMA busy_timeout` returns 5000; `PRAGMA journal_mode` returns `wal`; `PRAGMA foreign_keys` returns 1.
- SQLite version is 3.35 or newer.

**Tests:**
- `tests/unit/money.test.ts`: sums, rejects floats, rejects negatives.
- `tests/unit/state.test.ts`: every legal transition passes; every illegal transition throws (list all in the file).
- `tests/unit/ids.test.ts`: ULID is 26 characters and time-sortable; memo for a sample batch is at most `MEMO_MAX_BYTES`; oversized memo throws.
- `tests/integration/db.test.ts`: write, reopen connection, read back; `UNIQUE (device_id, epoch, seq)` fires; two processes writing concurrently (spawned child) do not produce `SQLITE_BUSY` errors within the timeout; pragmas match section 5.9.

**GATE:** Show test output, pragma values, and seeded row counts. Update `PROGRESS.md`. Stop and wait for "go".

---

### Phase 2: Ingest API and security

**Model:** Gemini 3.8 High

**Goal:** Accept only authentic, unique, rate-limited events. Never touch Solana. Handle device resets and conflicts visibly.

**Build:**
1. `src/lib/canonical.ts`: canonical JSON with fixed key order (`amountLamports, businessId, deviceId, epoch, occurredAt, seq`) and no whitespace. Include a fixed test vector.
2. `src/lib/crypto.ts`: sha256 helper, Ed25519 verify (base64 in, boolean out), payload hash.
3. `src/lib/rate-limit.ts`: atomic SQLite fixed window (section 5.8), using the single upsert statement. Config: `RATE_LIMIT_PER_MIN`.
4. `src/app/api/v1/events/route.ts`: POST handler implementing section 5.1 exactly, including the 409 conflict path and the new-epoch audit entry.
5. `src/app/api/v1/events/[id]/route.ts`: GET one event with its state. Never return the signature in full to other businesses.
6. Auth helper: hash the bearer token, look up the business, return 401 if missing.
7. Audit log writes for: rejected signature, ownership failure, rate-limit hit, conflict (409), new epoch registration.
8. `src/lib/lifecycle.ts` registered in the app process: handle `SIGINT` and `SIGTERM` as described in 5.10 (stop accepting requests, wait for in-flight requests up to `SHUTDOWN_GRACE_MS`, close the database, exit 0; a second signal exits 1).

**Acceptance:**
- Valid signed event returns 202.
- The same event again returns 200 with `duplicate: true`; one row in the DB.
- Altered amount with the same epoch and seq returns 409 (not 200), and the original row is unchanged.
- Altered signature returns 401.
- Another business's device returns 403.
- Device reset: a new epoch with seq 1 returns 202 and creates a new row; the audit log records the new epoch.
- Requests beyond `RATE_LIMIT_PER_MIN` in one minute return 429.
- Sending SIGINT to the app during requests lets in-flight requests finish and exits 0.

**Tests:**
- `tests/unit/canonical.test.ts`: fixed test vector; key order independent of input object order.
- `tests/unit/crypto.test.ts`: valid signature verifies; altered payload fails; wrong key fails.
- `tests/unit/rate-limit.test.ts`: the upsert returns incrementing counts in one window; a new window starts at 1; concurrent calls in the same window produce exact counts with no lost increments.
- `tests/integration/ingest.test.ts`: every acceptance case above, using real route handlers.
- `tests/security/ingest-security.test.ts`: S1, S2, S3, S6, S10, S11, S16, S17 from section 7.1, plus a 30-case malformed payload table.
- `tests/integration/app-shutdown.test.ts`: SIGINT during in-flight requests (S20, app side).

**GATE:** Show the test summary and `npm audit --omit=dev` output. Update `PROGRESS.md` and `TESTS.md`. Stop and wait for "go".

---

### Phase 3: Solana integration and RPC router

**Model:** Gemini 3.8 High

**Goal:** Reliable DevNet access with failover and shared breaker state.

**Build:**
1. Look up the current DevNet genesis hash in the Solana docs. Record it in `config.ts` with the source comment. Do not guess.
2. `src/lib/rpc-router.ts`: endpoint list, per-endpoint circuit breaker stored in `system_state` (section 5.6), per-request timeouts, chaos flag reads from `system_state`, and `callWithFailover(fn)` that tries endpoints in order and records outcomes.
3. Startup check: `getGenesisHash` must equal `DEVNET_GENESIS_HASH`. Otherwise refuse to start.
4. `src/lib/solana.ts`:
   - `getFreshBlockhash()`: always calls the network, never caches.
   - `buildSettlementTx(payeeAddress, lamports, memoText, blockhash, treasuryKeypair)`.
   - `checkSignatureStatuses(signatures)` through the router.
   - `getBalanceSafe(address)`.
5. `scripts/keygen.ts`: create a treasury keypair in `keys/treasury.json` and print only its public key.
6. Fund the treasury via the DevNet faucet manually. Record this step in the README. Do not automate the faucet.

**Acceptance:**
- Startup against DevNet succeeds and prints the cluster as DevNet.
- Startup against a mock mainnet genesis hash refuses to run.
- A transfer with memo lands on DevNet; the signature opens on Explorer.
- Chaos "down" on endpoint 1, set through `system_state`, makes the router use endpoint 2 automatically.

**Tests:**
- `tests/unit/rpc-router.test.ts`: breaker opens after 3 failures; cooldown closes it; half-open success closes it; all-open does not throw.
- `tests/integration/solana-devnet.test.ts`: one real DevNet transfer with memo. Skipped with a clear message if the treasury balance is below threshold.
- `tests/chaos/failover.test.ts`: endpoint 1 timing out; call succeeds via endpoint 2.
- `tests/integration/cross-process-chaos.test.ts`: a chaos flag written by the app's chaos route, read by a separately spawned worker router, changes the worker's endpoint choice (S19).

**GATE:** Show the DevNet signature and Explorer link. Show test output. Update `PROGRESS.md`. Stop and wait for "go".

---

### Phase 4: Settlement worker, recovery, and shutdown

**Model:** Gemini 3.8 High

**Goal:** Batch, submit, retry safely, reconcile, recover without human action, and stop cleanly.

**Build:**
1. `src/worker/batcher.ts`: section 5.2 exactly, including the `MAX_BATCH_LAMPORTS` split.
2. `src/worker/settle.ts`: section 5.3 and 5.4 exactly. Fetch a fresh blockhash inside the submit step. Validate the memo length before signing (S18). Store `serialized_tx`, `signature`, and `last_valid_block_height` before sending. Check the treasury balance before sending (S14).
3. `src/worker/index.ts`:
   - On startup: run the integrity check, resume every batch in `submitted` or `retrying`, run reconciliation once, then start the loop.
   - Loop with config intervals. Check `isShuttingDown` between every step.
   - Register `SIGINT` and `SIGTERM` through `src/lib/lifecycle.ts` and follow section 5.10 exactly: finish the current step, wait for the grace timer, run `wal_checkpoint(TRUNCATE)`, close the database, exit 0. A second signal exits 1.
4. Reconciliation runner per section 5.5, writing to `reconciliations`, including the passive checkpoint. Also prunes old `rate_windows` older than 10 minutes (5.8).
5. Worker writes plain-language log lines, for example: `"Batch 01J... is waiting for the network. Retry 2 of 5."`
6. `SHUTDOWN_GRACE_MS` read from config (default 10000).
7. `scripts/report.ts` is added in Phase 7, not here.

**Acceptance:**
- Queue 50 events; they become a small number of batches; all confirm on DevNet.
- Stop the worker with SIGINT during submission; restart; no duplicate payment (verified by reconciliation).
- Stop the worker with SIGKILL during submission; restart; no duplicate payment (verified by reconciliation).
- With all endpoints down (chaos `down` set through the dashboard API), events keep queuing; after restore, the queue drains with no manual step.
- Treasury below threshold: no transaction sent; log explains why.
- Memo over `MEMO_MAX_BYTES`: batch fails as `failed_review`, nothing sent.
- After a graceful stop, the `-wal` file is removed or empty.

**Tests:**
- `tests/unit/batcher.test.ts`: grouping by payee, oldest first, split at max, hash determinism.
- `tests/unit/retry-policy.test.ts`: every branch of 5.4 (confirmed elsewhere, not found before expiry, not found after expiry, max attempts).
- `tests/unit/blockhash-freshness.test.ts`: submit step calls the network for a blockhash every time; a cached value is never reused across attempts.
- `tests/integration/worker.test.ts`: full lifecycle queued → batched → submitted → paid with a mocked RPC.
- `tests/integration/worker-shutdown.test.ts`: SIGINT mid-batch finishes the current step and exits 0; the batch is still in `submitted` and resumes on restart; a second signal exits 1.
- `tests/chaos/outage.test.ts`: RPC down for simulated 60 seconds; events keep queuing; restore; drain; `recovery_seconds_last` recorded.
- `tests/chaos/crash-midbatch.test.ts`: SIGKILL after submit, before confirm; restart; exactly one confirmed batch per event.
- `tests/chaos/lying-rpc.test.ts`: chaos `lie` mode; no false "paid".
- `tests/integration/treasury-guard.test.ts`: empty treasury blocks sends.
- `tests/security/memo-limit.test.ts`: oversized memo refused before signing (S18).
- `tests/integration/wal-checkpoint.test.ts`: after a burst of 1,000 writes, the worker's passive checkpoint runs and reads still succeed during the checkpoint.

**GATE:** Show outage test output with recovery time, the reconciliation row (`lost=0`, `onchain_duplicates=0`), and the shutdown test output for both SIGINT and SIGKILL. Update `PROGRESS.md` and `TESTS.md`. Stop and wait for "go".

---

### Phase 5: Device simulator

**Model:** Gemini 3.8 Medium

**Goal:** Realistic traffic, including device resets, for demos and load tests.

**Build:**
1. `scripts/device-sim.ts`:
   - Signs events with each device's private key from `keys/devices/`.
   - Persists `epoch` and `seq` to a per-device state file (`keys/devices/<id>.state.json`) after every accepted send, so a restart continues the sequence.
   - Modes: `normal` (configurable rate), `burst` (for example 1,000 events in 10 seconds, using the load test's higher rate limit), `offline` (buffers locally and sends later in sequence order), `reset` (deletes the device's state file and resumes with a new epoch).
   - Prints one plain-language line per event: `"Charger 2 recorded 0.05 SOL session #17"`.
2. Offline mode sends buffered events in sequence order after reconnect, with no gaps.
3. The simulator handles `SIGINT` by saving its state file before exiting.

**Acceptance:**
- Normal run of 500 events: 0 rejections.
- Burst of 1,000 events: all accepted under the load-test rate limit; queue drains afterward.
- Offline buffer of 100 events delivered in order after reconnect.
- Reset mode: after the state file is deleted, new events under a new epoch are accepted; zero 409s from legitimate resets.

**Tests:**
- `tests/unit/device-sim.test.ts`: signing matches verifier; offline buffer ordering; state file persistence.
- `tests/integration/device-reset.test.ts`: reset path end to end (S16).
- `tests/load/burst.test.ts`: 1,000-event burst; record ingest p95, drain time, and peak `-wal` size in `TESTS.md`.

**GATE:** Show burst results and reset test output. Update `PROGRESS.md` and `TESTS.md`. Stop and wait for "go".

---

### Phase 6: Operator console (dashboard)

**Model:** Gemini 3.8 Medium

**Goal:** Clear, attractive, mobile-ready view of the whole system.

**Build:**
1. `src/app/globals.css` and Tailwind config with the tokens from section 9.2.
2. Components from section 2.3.
3. `src/app/page.tsx`: polls `/api/v1/metrics`, `/api/v1/batches`, `/api/v1/reconciliation` every 2 seconds. Reads SQLite only, through the API.
4. `ChaosControls`: visible only when `CHAOS_ENABLED=true`. Buttons: "Simulate network outage", "Restore network", "Make one endpoint lie", "Burst 1,000 events" (triggers the simulator through a documented command, not from the browser).
5. Explorer links: `https://explorer.solana.com/tx/<sig>?cluster=devnet`.
6. Status labels and tooltips from section 9.3, including the conflict label.
7. Empty states: "No payments yet. Start the device simulator to see events arrive."
8. Loading and error state for each panel. The page never shows a blank screen.

**Acceptance:**
- All panels present; they update live during a simulator run.
- Outage button turns the chain status red while the Waiting counter keeps rising. This proves the cross-process chaos path works.
- Works at 375px width with no horizontal page scroll.
- Respects `prefers-reduced-motion`.
- Contrast check passes for body text.

**Tests:**
- `tests/unit/status-labels.test.ts`: every internal state maps to a label and tooltip.
- `tests/e2e/dashboard.test.ts` (Playwright, or a documented manual checklist if Playwright is blocked): page loads; panels present; chaos toggle updates status.
- Accessibility check with axe-core on the main page: zero serious violations.

**GATE:** Attach screenshots at desktop and mobile widths. Show test or checklist results. Update `PROGRESS.md`. Stop and wait for "go".

---

### Phase 7: Metrics and observability

**Model:** Gemini 3.8 Medium

**Goal:** Every number in the demo is measured, not typed.

**Build:**
1. `src/lib/metrics.ts`: reads counters, latency samples, breaker states, `-wal` file size, and recovery records from SQLite. Percentile calculation over `latency_samples`. Prunes samples to the most recent 10,000 per kind.
2. `/api/v1/metrics`: returns every metric from section 8.1.
3. Recovery timer: the worker records the time from endpoint restore to queue empty in `system_state` key `recovery:last`.
4. `scripts/report.ts`: prints a plain-English summary of the last run, suitable for the README.

**Acceptance:**
- Every metric in section 8.1 returns a value.
- Recovery time is recorded automatically after an outage test.
- `scripts/report.ts` numbers match dashboard numbers.

**Tests:**
- `tests/unit/metrics.test.ts`: counter increments, percentile calculation on known data.
- `tests/integration/metrics-endpoint.test.ts`: all keys present; changing inputs changes outputs (no hardcoded values).

**GATE:** Show `scripts/report.ts` output. Update `PROGRESS.md`. Stop and wait for "go".

---

### Phase 8: Full test and security hardening

**Model:** Gemini 3.8 High

**Goal:** Prove the three rules hold under every failure we can simulate.

**Build:**
1. Complete any missing tests from Phases 1–7.
2. `tests/security/` covers every row S1–S20.
3. `tests/chaos/` covers: RPC down, RPC 429, RPC timeout, process kill mid-batch (SIGKILL), graceful stop mid-batch (SIGINT), network restored, lying RPC, empty treasury, device reset, clock skew (device timestamp more than 24 hours off is accepted but flagged for review), and backward clock step in rate limiting.
4. Run the full suite three times to check for flakiness. Record all three runs in `TESTS.md`.
5. Run `npm audit --omit=dev`. Fix or document each high and critical finding in `SECURITY.md`.
6. `TESTS.md`: date, command, pass and fail counts, duration, and the three-rule check (lost = 0, on-chain duplicates = 0, recovery automatic) for each chaos scenario.

**Acceptance:**
- Full suite passes three times in a row.
- Every S-row has a passing test linked in `SECURITY.md`.
- Zero unresolved high or critical audit issues.

**GATE:** Show `TESTS.md`. Update `PROGRESS.md`. Stop and wait for "go".

---

### Phase 9: Documentation and demo

**Model:** Gemini 3.8 Low

**Goal:** Anyone can clone, run, understand, and demo the project.

**Build:**
1. `README.md`:
   - What it is: plain language first, then technical.
   - Quick start: install, keygen, faucet step, seed, start worker, start app, start simulator.
   - Single host deployment note (no serverless).
   - "Stopping safely" section: how to stop each process, and why both graceful and forced stops are safe.
   - "Try the outage demo" section with exact steps.
   - Architecture diagram from section 2.1.
   - Links to `SECURITY.md`, `TESTS.md`, `KNOWN_LIMITS.md`.
2. `SECURITY.md`: from section 7.2.
3. `KNOWN_LIMITS.md`: real hardware not tested; treasury is server-held; no sybil resistance; not audited; DevNet only; single host; SQLite single-file design; RPC providers may share a common failure cause.
4. `docs/demo-script.md`: the 90-second script (section 13) with exact button presses.
5. `docs/operator-summary.md`: exportable one-page summary generated by `scripts/report.ts`.
6. Clean-clone test: clone into a new folder, follow the README exactly, record any step that fails, fix the README.

**Acceptance:**
- Fresh clone runs in under 10 minutes following the README.
- Demo script runs end to end with no manual code edit.

**GATE:** Show the clean-clone log. Update `PROGRESS.md`. Stop and wait for "go".

---

### Phase 10: Final Definition of Done

**Model:** Gemini 3.8 Medium

**Goal:** Verify every item in section 12 with evidence. Do not change features in this phase.

**Build:** Walk the Definition of Done list. For each item, record evidence (file path, test name, screenshot, or log line) in `PROGRESS.md`.

**Acceptance:** Every item is checked with evidence. Any unmet item is reported honestly with the reason.

**GATE:** Print the final report (section 12.2). Stop. The project is complete when the user confirms.

---

## 11. Environment variables

| Variable | Example | Purpose |
|---|---|---|
| `CLUSTER` | `devnet` | Must be devnet; anything else refuses to start |
| `RPC_ENDPOINTS` | `https://api.devnet.solana.com,https://...` | At least 2 for failover |
| `TREASURY_KEYPAIR_PATH` | `./keys/treasury.json` | Server-held DevNet treasury |
| `TREASURY_MIN_LAMPORTS` | `100000000` | Refuse batches below this balance |
| `DB_PATH` | `./data/trickle.db` | SQLite file, shared by app and worker |
| `ADMIN_API_KEY` | (generate locally) | Protects chaos routes |
| `CHAOS_ENABLED` | `true` | Enables fault injection (dev only) |
| `BATCH_INTERVAL_MS` | `5000` | Batch cadence |
| `BATCH_MAX_EVENTS` | `100` | Max events per batch |
| `MAX_BATCH_LAMPORTS` | `1000000000` | Split batches above this |
| `MAX_EVENT_LAMPORTS` | `100000000` | Reject larger single events |
| `MAX_ATTEMPTS` | `5` | Before failed_review |
| `MEMO_MAX_BYTES` | `120` | Refuse memos longer than this |
| `RECONCILE_INTERVAL_MS` | `30000` | Reconciliation cadence |
| `CB_FAILURE_THRESHOLD` | `3` | Circuit breaker |
| `CB_COOLDOWN_MS` | `30000` | Circuit breaker cooldown |
| `RPC_TIMEOUT_MS` | `8000` | Per request timeout |
| `RATE_LIMIT_PER_MIN` | `600` | Per business API key; load test overrides |
| `SHUTDOWN_GRACE_MS` | `10000` | Time allowed for a graceful stop before exit |

Never commit real values. `.env.example` contains placeholders only.

---

## 12. Definition of Done

### 12.1 Checklist

1. Simulator generates at least 500 events across 3 devices, all accepted.
2. Outage test: lost = 0, verified by reconciliation.
3. Each event appears in exactly one confirmed batch on DevNet (on-chain duplicates = 0).
4. After network restore, pending batches confirm with no manual action. Recovery time recorded.
5. Every batch shows state and a working Explorer link.
6. Process refuses to run against mainnet (tested).
7. Device reset test: new epoch accepted, nothing dropped, conflicts return 409 (S16, S17).
8. All security tests S1–S20 pass. `npm audit --omit=dev` has no unresolved high or critical issues.
9. Dashboard "Simulate outage" click affects the worker's behavior (S19 test passes).
10. Graceful stop and forced kill both recover with lost = 0 and on-chain duplicates = 0 (S20 test passes).
11. Burst test records peak `-wal` size and shows it stays bounded.
12. Clean clone runs with the README in under 10 minutes.
13. Dashboard works at 375px and at desktop width.
14. Dashboard passes accessibility check with zero serious violations.
15. Full test suite passes three consecutive runs; results in `TESTS.md`.
16. A 90-second demo video is recorded and linked in the README.
17. `KNOWN_LIMITS.md` and `SECURITY.md` are complete and honest.
18. Every metric on the dashboard comes from SQLite.
19. Business API keys stored hashed; no secrets in the repo.

### 12.2 Final report format

- Items passed, with evidence links.
- Items not met, with reason.
- Test totals and dates from `TESTS.md`.
- Known limits in one paragraph.

---

## 13. Demo script (90 seconds)

| Time | Action | Say (plain) | Say (technical, one line) |
|---|---|---|---|
| 0:00 | Show dashboard, all green | "Three chargers are sending sessions to a business's payment system." | "Ingest is separate from Solana; the queue records first." |
| 0:15 | Start normal traffic | "Each session is recorded and then paid in small batches." | "Batches carry a memo with the batch ID and an events hash." |
| 0:35 | Click "Simulate network outage" | "The payment network is down. Watch what keeps working." | "The circuit breaker opens in shared state; ingest is unaffected." |
| 0:50 | Point at Waiting counter rising | "Nothing is lost. Sessions wait safely." | "Events are durable in SQLite with unique keys." |
| 1:00 | Click "Restore network" | "The network is back. Payments resume by themselves." | "Pending batches resume; expired ones are rebuilt with a fresh blockhash; nothing is sent twice." |
| 1:15 | Show reconciliation: lost 0, duplicates 0 | "Every session is accounted for, and nothing was paid twice." | "Reconciliation checks on-chain memo hashes against stored events." |
| 1:25 | Click an Explorer link | "Here is the proof on Solana's public test network." | "The memo and transfer are visible in the transaction." |

---

## 14. Known limits (state in the demo)

- Solana DevNet only. Not for real money.
- Operator payments come from a server-held DevNet treasury, not from each user's wallet.
- Devices are simulated. Real hardware is not tested.
- Fake devices can still earn (no sybil resistance).
- Security is tested, not audited.
- Single host and single SQLite file. Not built for multi-server or serverless scale.
- RPC providers may still share a common failure cause, such as a network-wide outage.
- Solana constants (genesis hash, blockhash validity window, memo and transaction size limits) are verified against the docs at build time, not assumed.

---

## 15. Future improvements (not in scope)

- Multi-tenant admin with business sign-up.
- Webhooks to businesses on payment confirmation.
- Device identity attestation and epoch approval flow.
- Per-payee spending limits and approval flows.
- Postgres for multi-server deployment.
- External audit before any mainnet discussion.

---

## 16. Phase report format

At each GATE, print exactly this:

```
PHASE N: <name>
Model: <Gemini 3.8 Low | Medium | High>
Status: COMPLETE | BLOCKED
Files created or changed: <list>
Tests run: <command> → <pass count> / <total>, <duration>
Acceptance checklist:
  [x] item (evidence)
  [ ] item (reason not met)
Security or risk notes: <list or "none">
Model switches this phase: <none or details>
Next: waiting for "go"
```

---

## 17. Quick reference for the coder

- One phase per "go". Use the phase's model.
- Stop at every GATE.
- No mainnet. No secrets in code or logs.
- Tests are the proof. Show real output.
- Cross-process state lives in SQLite, never in memory.
- Blockhash is fetched at submit time, never cached.
- Same event key with different content is a 409, never a silent overwrite.
- Rate limiting is one atomic upsert statement.
- Only PASSIVE checkpoints while running; TRUNCATE only at clean shutdown.
- Stop signals finish the current step and never start a new external action.
- If unsure about a Solana value, check the docs first.
- If blocked, report and wait. Do not guess.