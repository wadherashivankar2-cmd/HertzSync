# Test Log and Results

## Unit Tests
- `tests/unit/canonical.test.ts`: 2 passed / 2 total (strict key order, whitespace omission, scrambled input order invariance)
- `tests/unit/crypto.test.ts`: 4 passed / 4 total (Ed25519 signature verification, payload tampering rejection, key mismatch rejection, sha256 payload hash)
- `tests/unit/rate-limit.test.ts`: 4 passed / 4 total (atomic increment, fixed 1-minute window reset, Retry-After header calculation, 10-minute window pruning)
- `tests/unit/config.test.ts`: 3 passed / 3 total (devnet config, mainnet rejection, missing fields)
- `tests/unit/money.test.ts`: 5 passed / 5 total (integer sums, float rejection, negative rejection, 9-decimal SOL formatting/parsing)
- `tests/unit/state.test.ts`: 4 passed / 4 total (legal/illegal event and batch transitions)
- `tests/unit/ids.test.ts`: 3 passed / 3 total (ULID time-sortability, memo length check, oversized memo rejection)
- `tests/unit/rpc-router.test.ts`: 6 passed / 6 total
  - Breaker opens after 3 failures (`CB_FAILURE_THRESHOLD`)
  - Cooldown transitions open breaker to half-open
  - Half-open success closes breaker and resets counter
  - All-open returns null without throwing unhandled exceptions
  - Failover to second endpoint when first throws error
  - Immediate failover when first endpoint has chaos 'down' mode
- `tests/unit/batcher.test.ts`: 4 passed / 4 total
  - Hash determinism: `events_hash` is sha256 of sorted event IDs joined by newline
  - Grouping by payee: creates separate batches for different payees
  - Oldest first: selects queued events in ascending order of arrival
  - Split at max: splits batch when `MAX_BATCH_LAMPORTS` or `BATCH_MAX_EVENTS` is reached
- `tests/unit/retry-policy.test.ts`: 4 passed / 4 total
  - Branch 1: confirmed elsewhere -> marks confirmed and does not resend
  - Branch 2: not found before expiry (height <= last_valid) -> resends identical `serialized_tx` (double-pay safe)
  - Branch 3: not found after expiry (height > last_valid) -> rebuilds with fresh blockhash, sets `expired_rebuilt`, then `submitted`
  - Branch 4: max attempts exceeded -> moves to `failed_review` and flags events
- `tests/unit/blockhash-freshness.test.ts`: 2 passed / 2 total
  - Submit step calls network for a blockhash every time without reusing cached values
  - Retry after expiry fetches fresh blockhash from network and updates `last_valid_block_height`
- `tests/unit/device-sim.test.ts`: 5 passed / 5 total
  - Generates valid Ed25519 keypair and signs events matching verifier
  - State persistence: saves and resumes epoch/seq cleanly without gaps
  - Offline buffering: queues events locally and flushes in sequence order
  - Guarded reset: deletes `<id>.state.json` ONLY, preserving `<id>.json`
  - Plain language formatting: "Charger 2 recorded 0.05 SOL session #17"
- `tests/unit/status-labels.test.ts`: 3 passed / 3 total
  - Blueprint Section 9.3 internal state mapping to plain English labels, colors, and tooltips
  - Batch settlement lifecycle states mapping
  - Unknown state fallback formatting

## Integration Tests
- `tests/integration/db.test.ts`: 4 passed / 4 total (WAL mode, busy_timeout=5000, foreign_keys=1, reopen persistence, unique key constraint, concurrent child/parent process writes)
- `tests/integration/ingest.test.ts`: 8 passed / 8 total
  - Valid signed event returns 202 queued
  - Duplicate retransmission returns 200 duplicate: true
  - Conflicting payload returns 409 conflict
  - Invalid signature returns 401
  - Unauthorized API key returns 401
  - Device belonging to another business returns 403
  - Device reset with new epoch returns 202 and registers in audit_log
  - GET /api/v1/events/:id returns event state without exposing raw signature
- `tests/integration/app-shutdown.test.ts`: 1 passed / 1 total (in-flight requests finish cleanly before exit 0 on SIGINT)
- `tests/integration/solana-devnet.test.ts`: 4 passed / 4 total
  - Cluster genesis hash check matches official DevNet genesis hash (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`)
  - Refuses startup if cluster genesis hash mismatch (S4 mainnet guard)
  - Fetches fresh blockhash from live DevNet cluster
  - Live DevNet transfer with memo (skips safely if treasury balance < `TREASURY_MIN_LAMPORTS`)
- `tests/integration/cross-process-chaos.test.ts`: 4 passed / 4 total
  - S13: Returns 404 when `CHAOS_ENABLED` is false
  - Returns 401 when admin key is missing or invalid
  - Returns 400 on malformed payload or unknown mode
  - S19: Chaos flag written via app API route directly alters router endpoint selection in a separately spawned child worker process via SQLite `system_state`
- `tests/integration/worker.test.ts`: 1 passed / 1 total
  - Full lifecycle queued -> batched -> submitted -> paid with mocked RPC; reconciliation verifies 0 lost
- `tests/integration/worker-shutdown.test.ts`: 2 passed / 2 total
  - SIGINT mid-batch finishes current step, exits 0, preserves submitted batch, and resumes on restart
  - Second signal exits immediately with code 1
- `tests/integration/treasury-guard.test.ts`: 3 passed / 3 total
  - Blocks sends and logs plain English warning when treasury is empty (0 lamports)
  - Blocks sends when treasury balance is below `TREASURY_MIN_LAMPORTS` threshold
  - Allows send when treasury balance satisfies `TREASURY_MIN_LAMPORTS`
- `tests/integration/wal-checkpoint.test.ts`: 1 passed / 1 total
  - Passive checkpoint executes safely during burst writes, and reads succeed without blocking
- `tests/integration/chain-duplicates.test.ts`: 3 passed / 3 total
  - Detects duplicate events hashes in full treasury signature history
  - Historical test duplicates detected and logged
  - Dynamic runId isolation ensures zero cross-run hash collisions
- `tests/integration/device-reset.test.ts`: 4 passed / 4 total
  - Epoch 1 events accepted with HTTP 202
  - Reset deletes state file only and preserves device identity key file
  - Epoch 2 events accepted with zero 409 conflicts
  - Reusing (epoch 1, seq 1) with different payload produces 409 event_conflict
- `tests/integration/dashboard-api.test.ts`: 4 passed / 4 total
  - GET /api/v1/metrics returns complete metrics, endpoint states, and audit log from SQLite only
  - GET /api/v1/batches returns batches with payee labels and explorer URLs
  - GET /api/v1/reconciliation returns latest conservation report
  - POST /api/v1/chaos alters system_state which is immediately reflected in GET /api/v1/metrics

## Security Tests
- `tests/security/ingest-security.test.ts`: 5 passed / 5 total
  - S1: Replayed events deduplicated (20 sends create 1 DB row)
  - S2: Forged event with altered amount returns 401
  - S6: Database dump contains only SHA-256 hashes of API keys
  - S11: Table of 30 malformed payloads all return 400
  - S17: Conflicting content returns 409 and leaves original row intact
- `tests/security/memo-limit.test.ts`: 2 passed / 2 total
  - `buildBatchMemo` rejects memos exceeding `MEMO_MAX_BYTES` (120 bytes)
  - `submitBatch` refuses to sign when memo exceeds 120 bytes, marks `failed_review`, flags events, and logs audit

## Chaos & Recovery Tests
- `tests/chaos/failover.test.ts`: 2 passed / 2 total
  - Endpoint 1 timing out; call succeeds via endpoint 2
  - Breaker trips on endpoint 1 after 3 timeouts, routing subsequent calls directly to endpoint 2
- `tests/chaos/outage.test.ts`: 1 passed / 1 total
  - RPC down for simulated 60 seconds; events keep queuing; restore; drain; `recovery_seconds_last` recorded
- `tests/chaos/crash-midbatch.test.ts`: 1 passed / 1 total
  - SIGKILL after submit, before confirm; restart; exactly one confirmed batch per event and 0 lost/duplicates
- `tests/chaos/lying-rpc.test.ts`: 1 passed / 1 total
  - Chaos `lie` mode; detects single lying RPC and refuses to mark batch confirmed or events paid

## Load Tests
- `tests/load/burst.test.ts`: 1 passed / 1 total
  - 1,000-event burst across 10 devices with `RATE_LIMIT_PER_MIN = 10000` in test environment (production default remains 600)
  - Ingest p95 Latency: 7.45 ms (requirement: < 100 ms)
  - Latency breakdown: min=5.33 ms, mean=6.37 ms, p50=6.19 ms, p95=7.45 ms, p99=10.49 ms, max=33.88 ms
  - Total Ingest Duration: 10,218 ms (throughput: 97.9 events/sec)
  - Peak SQLite -wal Size: 4,161,232 bytes (4,063.7 KB)
  - Drain Duration: 109.83 ms across 10 batches of 100 events each
  - Live Network Calls: 0 (Strict Zero DevNet calls via MockRpcRouter)
  - Reconciliation: generated=1000, accounted=1000, lost=0, duplicates=0, ok=true

## E2E Tests

---
**Total: 103 passed / 103 tests across 32 test suites**
