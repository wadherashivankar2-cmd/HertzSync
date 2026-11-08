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
- `tests/unit/metrics.test.ts`: 4 passed / 4 total
  - Persists and retrieves atomic counters from SQLite counters table
  - Computes p50 and p95 nearest-rank percentiles accurately on known dataset
  - Prunes latency_samples beyond boundary (maxPerKind = 10,000)
  - collectMetrics compiles complete Section 8.1 schema from SQLite only

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
- `tests/integration/metrics-endpoint.test.ts`: 2 passed / 2 total
  - GET /api/v1/metrics returns all Section 8.1 required keys and valid types
  - Dynamic derivation: metrics respond to database state changes without hardcoding

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
  - Simulator generated more than 1,000 events across 10 devices (exceeding the base requirement of 500 events across 3 devices), with zero drops. The 1,000-event burst test ran in a dedicated test environment with an elevated RATE_LIMIT_PER_MIN; the default production limit remains 600 requests per minute.
  - Ingest p95 Latency: 7.45 ms (requirement: < 100 ms)
  - Latency breakdown: min=5.33 ms, mean=6.37 ms, p50=6.19 ms, p95=7.45 ms, p99=10.49 ms, max=33.88 ms
  - Total Ingest Duration: 10,218 ms (throughput: 97.9 events/sec)
  - Peak SQLite -wal Size: 4,161,232 bytes (4,063.7 KB)
  - Drain Duration: 109.83 ms across 10 batches of 100 events each
  - Live Network Calls: 0 (Strict Zero DevNet calls via MockRpcRouter)
  - Reconciliation: generated=1000, accounted=1000, lost=0, duplicates=0, ok=true

## Clean-Clone Benchmark (Definition of Done Item 12)
- Clean clone completed in about 2 minutes on the test machine (automated agent benchmark; human manual setup estimated at 5-10 minutes).

## Phase 8 Test Hardening & Three Consecutive Test Runs

Environment: `MAX_LIVE_TRANSFERS_PER_TEST_RUN=0`

| Run # | Start Time (UTC) | Test Files Passed | Total Tests Passed | Total Duration | Summary Line |
|---|---|---|---|---|---|
| **Run 1** | 2026-11-08 02:02:27 | 34 / 34 | 109 / 109 | 17.16s | `Test Files  34 passed (34) \| Tests  109 passed (109) \| Duration  17.16s` |
| **Run 2** | 2026-11-08 02:03:31 | 34 / 34 | 109 / 109 | 17.69s | `Test Files  34 passed (34) \| Tests  109 passed (109) \| Duration  17.69s` |
| **Run 3** | 2026-11-08 02:04:34 | 34 / 34 | 109 / 109 | 16.67s | `Test Files  34 passed (34) \| Tests  109 passed (109) \| Duration  16.67s` |

Consistency: 100% pass rate across all 3 consecutive runs (34 suites, 109 tests, 0 flakes, 0 failures).

## Dependency Audit Results (Phase 8 Definition of Done & Item 8)

Command: `npm audit --omit=dev`
- **Audit Assessment**: 0 critical; 1 high is an approved, documented exception (PostCSS build tooling within Next.js); 5 moderate in pinned @solana/web3.js 1.x dependencies. All documented with feature-usage analysis in SECURITY.md.
- **Total Vulnerabilities**: 6 (0 critical, 1 high, 5 moderate)
- **High Severity (1)**: `postcss` (<=8.5.22) via `next@15.5.29`. Formally reviewed and recorded as an approved exception on 7th Nov, 2026. Only used for build-time static CSS compilation.
- **Moderate Severity (5)**: `stream-json` and `uuid` via `jayson` inside pinned `@solana/web3.js` 1.x line (`^1.98.0`). Not exposed to untrusted external input.
- **Critical Findings in Production**: 0.

---
**Total: 109 passed / 109 tests across 34 test suites**

---

## Theme upgrade and 404 upgrade (visual only)

### 1. Contrast Ratios Table

Measured relative luminance and contrast ratios calculated per WCAG 2.1 specifications:

#### Dark Mode (Base: `#0A0F1F`, Surface: `#131B35`, Accent: `#FF8A4C`)
| Element | Foreground | Background | Measured Ratio | WCAG Target | Status |
|---|---|---|---|---|---|
| Primary Text on Base | `#F1F5F9` | `#0A0F1F` | **17.41:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Primary Text on Surface | `#F1F5F9` | `#131B35` | **15.51:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Muted Text on Base | `#94A3B8` | `#0A0F1F` | **7.44:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Muted Text on Surface | `#94A3B8` | `#131B35` | **6.63:1** | 4.5:1 (Body Text) | PASS (AA) |
| Button Label on Accent | `#0A0F1F` | `#FF8A4C` | **8.17:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Focus Ring against Base | `#FF8A4C` | `#0A0F1F` | **8.17:1** | 3.0:1 (Non-text UI) | PASS (AAA) |
| Focus Ring against Surface | `#FF8A4C` | `#131B35` | **7.28:1** | 3.0:1 (Non-text UI) | PASS (AAA) |
| Status Badge (Success) | `#6EE7B7` | `#131B35` | **11.15:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Status Badge (Pending) | `#FCD34D` | `#131B35` | **11.78:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Status Badge (Error) | `#FCA5A5` | `#131B35` | **8.95:1** | 4.5:1 (Body Text) | PASS (AAA) |
| 404 Headline on Base | `#F1F5F9` | `#0A0F1F` | **17.41:1** | 3.0:1 (Large Text) | PASS (AAA) |

#### Light Mode (Base: `#F4F6FB`, Surface: `#FFFFFF`, Accent: `#C2410C`)
| Element | Foreground | Background | Measured Ratio | WCAG Target | Status |
|---|---|---|---|---|---|
| Primary Text on Base | `#0F172A` | `#F4F6FB` | **16.51:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Primary Text on Surface | `#0F172A` | `#FFFFFF` | **17.85:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Muted Text on Base | `#475569` | `#F4F6FB` | **7.01:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Muted Text on Surface | `#475569` | `#FFFFFF` | **7.58:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Button Label on Accent | `#FFFFFF` | `#C2410C` | **5.18:1** | 4.5:1 (Body Text) | PASS (AA) |
| Focus Ring against Base | `#C2410C` | `#F4F6FB` | **4.79:1** | 3.0:1 (Non-text UI) | PASS (AA) |
| Focus Ring against Surface | `#C2410C` | `#FFFFFF` | **5.18:1** | 3.0:1 (Non-text UI) | PASS (AA) |
| Status Badge (Success) | `#065F46` | `#FFFFFF` | **7.68:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Status Badge (Pending) | `#92400E` | `#FFFFFF` | **7.09:1** | 4.5:1 (Body Text) | PASS (AAA) |
| Status Badge (Error) | `#991B1B` | `#FFFFFF` | **8.31:1** | 4.5:1 (Body Text) | PASS (AAA) |
| 404 Headline on Base | `#0F172A` | `#F4F6FB` | **16.51:1** | 3.0:1 (Large Text) | PASS (AAA) |

### 2. Axe-Core Accessibility Audit

Executed automated axe-core accessibility audits via Chrome DevTools Protocol against the running production server:

| Surface & Theme | Critical | Serious | Moderate | Minor | Total Violations | Conformance |
|---|---|---|---|---|---|---|
| **Dashboard (Dark)** | 0 | 0 | 0 | 0 | **0** | PASS |
| **Dashboard (Light)** | 0 | 0 | 0 | 0 | **0** | PASS |
| **404 Page (Dark)** | 0 | 0 | 0 | 0 | **0** | PASS |
| **404 Page (Light)** | 0 | 0 | 0 | 0 | **0** | PASS |

### 3. Screenshots Captured

Screenshots captured across viewports and saved to the artifact repository:
1. `dashboard_desktop_1280_dark.png` (1280px Desktop, Dark Mode)
2. `dashboard_desktop_1280_light.png` (1280px Desktop, Light Mode)
3. `dashboard_mobile_375_dark.png` (375px Mobile, Dark Mode)
4. `dashboard_mobile_375_light.png` (375px Mobile, Light Mode)
5. `not_found_desktop_1280_dark.png` (1280px Desktop, 404 Page Dark Mode)
6. `not_found_desktop_1280_light.png` (1280px Desktop, 404 Page Light Mode)

### 4. HTTP 404 Route Verification

Command:
```bash
curl -i http://localhost:3000/does-not-exist
```
Output:
```http
HTTP/1.1 404 Not Found
```

### 5. Reduced-Motion Check

Evaluated computed style under `prefers-reduced-motion: reduce`:
```json
{
  "mediaMatches": true,
  "transitionDuration": "1e-05s"
}
```
All CSS animations and transitions are damped to `none !important` and `0.01ms !important`, and numerical count animations immediately settle on the target value.

### 6. Updated 404 Integration Test

Test file: `tests/integration/not-found.test.ts`
- Verifies exactly one `<h1>` heading with text `"This page isn't in the ledger."`
- Verifies `aria-hidden="true"` on the 404 background numeral and vector glyphs in upper area.
- Verifies both buttons with >= 44px min-target classes: primary (`/`) and secondary (`github.com/...#readme`).
- Confirms page renders standalone without needing dashboard metrics or props.
- Verifies route-level HTTP 404 status check on unknown routes (`/does-not-exist`).

### 7. Test Suite and Build Summary

- **Vitest Suite**:
  ```
  Test Files  36 passed (36)
       Tests  113 passed (113)
    Duration  26.33s
  ```
- **Next.js Production Build**:
  ```
  ✓ Compiled successfully in 3.4s
  Route (app)
  ┌ ○ /                                    8.18 kB         111 kB
  ├ ○ /_not-found                            140 B         103 kB
  ```
