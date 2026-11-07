# Test Log and Results

## Unit Tests
- `tests/unit/canonical.test.ts`: 2 passed / 2 total (strict key order, whitespace omission, scrambled input order invariance)
- `tests/unit/crypto.test.ts`: 4 passed / 4 total (Ed25519 signature verification, payload tampering rejection, key mismatch rejection, sha256 payload hash)
- `tests/unit/rate-limit.test.ts`: 4 passed / 4 total (atomic increment, fixed 1-minute window reset, Retry-After header calculation, 10-minute window pruning)
- `tests/unit/config.test.ts`: 3 passed / 3 total (devnet config, mainnet rejection, missing fields)
- `tests/unit/money.test.ts`: 5 passed / 5 total (integer sums, float rejection, negative rejection, 9-decimal SOL formatting/parsing)
- `tests/unit/state.test.ts`: 4 passed / 4 total (legal/illegal event and batch transitions)
- `tests/unit/ids.test.ts`: 3 passed / 3 total (ULID time-sortability, memo length check, oversized memo rejection)

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

## Security Tests
- `tests/security/ingest-security.test.ts`: 5 passed / 5 total
  - S1: Replayed events deduplicated (20 sends create 1 DB row)
  - S2: Forged event with altered amount returns 401
  - S6: Database dump contains only SHA-256 hashes of API keys
  - S11: Table of 30 malformed payloads all return 400
  - S17: Conflicting content returns 409 and leaves original row intact

## Chaos & Recovery Tests

## Load Tests

## E2E Tests
