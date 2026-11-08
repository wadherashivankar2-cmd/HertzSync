# Security Policy and Vulnerability Assessment

## Overview
TrickleSettle is a DePIN reliability middleware prototype built for **Solana DevNet**. It is not audited, does not handle real funds, and is strictly restricted from operating on mainnet.

## Deployment Model
- **Single Host Only**: Designed for execution on a single VM or physical host where the Next.js API server and settlement worker share a single SQLite database in WAL mode.
- Not designed for multi-tenant cloud serverless functions.

## Threat Controls & Status (Section 7.1)

| Threat # | Description | Control Mechanism | Status |
|---|---|---|---|
| S1 | Replayed event (double counting) | Unique constraint `(device_id, epoch, seq)`; duplicate content returns 200 duplicate, single DB row | Verified by tests (`tests/security/ingest-security.test.ts`, `tests/integration/ingest.test.ts`) |
| S2 | Forged event | Ed25519 cryptographic signature verification over canonical payload | Verified by tests (`tests/security/ingest-security.test.ts`, `tests/unit/crypto.test.ts`, `tests/integration/ingest.test.ts`) |
| S3 | Device ownership spoofing | Ownership check ensuring device belongs to authenticated business | Verified by tests (`tests/integration/ingest.test.ts`) |
| S4 | Mainnet used by accident | DevNet cluster requirement & genesis hash guard in config/router | Verified by tests (`tests/integration/solana-devnet.test.ts`, `tests/unit/config.test.ts`) |
| S5 | Key leakage | Keys only stored in gitignored `keys/` or `.env.local`; logger redacts key patterns | **Documented Gap** (Implemented in `.gitignore` and `src/lib/logger.ts`, but no automated test scans build output or runtime logs for key bytes) |
| S6 | Plaintext API keys | Business API keys stored solely as SHA-256 hashes | Verified by tests (`tests/security/ingest-security.test.ts`) |
| S7 | Oversized or abusive amounts | Max amount per event enforced (`MAX_EVENT_LAMPORTS`); max batch enforced | Verified by tests (`tests/security/ingest-security.test.ts`, `tests/unit/batcher.test.ts`, `tests/unit/money.test.ts`) |
| S8 | Duplicate payment on retry | Safe retry policy; identical signed tx resubmission; blockhash expiry checks | Verified by tests (`tests/unit/retry-policy.test.ts`, `tests/chaos/crash-midbatch.test.ts`, `tests/integration/chain-duplicates.test.ts`) |
| S9 | Single lying RPC | Cross-check signature status across multiple RPC endpoints | Verified by tests (`tests/chaos/lying-rpc.test.ts`) |
| S10 | API flooding / DoS | Atomic SQLite fixed-window rate limiter per API key hash | Verified by tests (`tests/unit/rate-limit.test.ts`) |
| S11 | Malformed input | Strict Zod validation schemas on all inputs | Verified by tests (30/30 test cases in `tests/security/ingest-security.test.ts`) |
| S12 | Vulnerable dependencies | `npm audit --omit=dev` scanning and documented exceptions | **Documented Gap** (Enforced at CLI/CI gate level via `npm audit --omit=dev`; no Vitest test file) |
| S13 | Chaos routes in production | Double guard: `CHAOS_ENABLED=true` and `NODE_ENV !== "production"` | Verified by tests (`tests/integration/cross-process-chaos.test.ts`) |
| S14 | Treasury drained by bug | Balance check against `TREASURY_MIN_LAMPORTS` before dispatch | Verified by tests (`tests/integration/treasury-guard.test.ts`) |
| S15 | Dev log leaks | Structured JSON logger with regex key redaction; no stack traces in API errors | **Documented Gap** (Implemented in `src/lib/logger.ts`; no automated test captures logger stdout to assert redaction) |
| S16 | Device reset drops events | `epoch` in unique key; new epoch accepted; audit log record | Verified by tests (`tests/integration/device-reset.test.ts`, `tests/integration/ingest.test.ts`, `tests/unit/device-sim.test.ts`) |
| S17 | Conflicting content accepted | Payload hash compared on duplicate; mismatch yields 409 conflict | Verified by tests (`tests/security/ingest-security.test.ts`, `tests/integration/ingest.test.ts`, `tests/integration/device-reset.test.ts`) |
| S18 | Memo bloat | Pre-signing length check against `MEMO_MAX_BYTES` (120 bytes) | Verified by tests (`tests/security/memo-limit.test.ts`, `tests/unit/ids.test.ts`) |
| S19 | Cross-process state drift | Circuit breaker, chaos flags, rate limits stored in SQLite | Verified by tests (`tests/integration/cross-process-chaos.test.ts`, `tests/integration/dashboard-api.test.ts`, `tests/integration/db.test.ts`) |
| S20 | Shutdown loss or double pay | State persisted before external action; graceful in-flight completion and resume | Verified by tests (`tests/integration/worker-shutdown.test.ts`, `tests/integration/app-shutdown.test.ts`, `tests/chaos/crash-midbatch.test.ts`) |

## Dependency Audit & Vulnerability Assessment (Section 7.1 S12)

Zod has been upgraded to **`zod@4.6.7`**, resolving GHSA-mrhx-c7xc-m3w5. The Zod vulnerability is completely gone from the audit report.

Running `npm audit --omit=dev` reports exactly **6 vulnerabilities (5 moderate, 1 high, 0 critical)**: 1 high-severity finding (`postcss` via Next.js, approved exception) and 5 moderate-severity findings from the pinned `@solana/web3.js` 1.x line. Zero critical vulnerabilities exist in production dependencies.

### 1. `postcss` (<=8.5.22) — High Severity (Next.js internal) — [EXCEPTION APPROVED]
- **Approval Date**: 7th Nov, 2026 (approved by user)
- **Approval Reason**: The finding is inside `next@15.5.29`, only processes trusted build-time Tailwind CSS styles, and the fix requires a breaking major upgrade to `next@16.4.5`. Next.js is retained on 15.x and not upgraded in this phase.
- **Vulnerability Details**: GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 (arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments) and GHSA-qx2v-qp2m-jg93 (CSS stringify XSS).
- **Dependency Location**: Indirect dependency. Bundled internally inside `next@15.5.29` (`node_modules/next/node_modules/postcss`). It is **not** a direct dependency in `package.json` (where Next.js is specified as `^15.1.0`).
- **Feature Usage & Impact**: **Our code does NOT use this affected feature.** PostCSS is invoked exclusively by Next.js at build time to compile our static Tailwind CSS files. It does not parse or compile untrusted, attacker-controlled CSS at runtime.

### 2. `@solana/web3.js` (1.x line) Transitive Dependencies — Moderate Severity

Per Blueprint section 2.4, `@solana/web3.js` must remain on the **1.x line** (`^1.98.0`), as migrating to 2.x/3.x is a major breaking rewrite incompatible with Blueprint specifications. `npm audit fix --force` must NOT be run. The transitive dependencies inside the 1.x line are assessed as follows:

| Package | Affected Versions | Advisory IDs | Feature Usage in Our Code | Residual Risk |
|---|---|---|---|---|
| **`stream-json`** (via `jayson` via `@solana/web3.js`) | `<=3.5.0` | GHSA-528h-pc64-c93x (DoS on O(depth²) nested input), GHSA-hqr4-qq8f-hg3x (JSONC comment rescan), GHSA-mjw6-4jj6-33hc (prototype pollution) | **Not used.** We use standard Solana RPC calls (`sendTransaction`, `getLatestBlockhash`, `getSignatureStatuses`) which return small, discrete JSON responses. Streaming JSON or untrusted nested object assemblers are not invoked. | Negligible. Responses come solely from configured Solana DevNet RPC endpoints over HTTPS. |
| **`jayson`** (via `@solana/web3.js`) | `2.0.6 - 4.3.0` | Depends on vulnerable versions of `stream-json` and `uuid` | **Not used.** Jayson is an internal RPC client transport within `@solana/web3.js` 1.x. We do not expose Jayson servers or accept incoming Jayson client connections. | Negligible. Transport is strictly internal to client RPC requests initiated by our application to DevNet endpoints. |
| **`uuid`** (via `jayson` via `@solana/web3.js`) | `<11.1.1` | GHSA-w5hq-g745-h8pq (Missing buffer bounds check in v3/v5/v6 when custom buffer is provided) | **Not used.** Neither our application code nor our Solana calls provide custom buffer arguments to `uuid.v3`, `v5`, or `v6`. Our code generates ULIDs via `src/lib/ids.ts` using crypto randomness. | None. Custom buffer invocation in UUID v3/v5/v6 is not utilized. |

## Critical Findings in Development Tooling (Dev Dependencies Only)

The full development `npm audit` reports 2 critical findings in local testing tooling:
1. **`tinypool` (<=2.1.1)**: GHSA-5gmw-xhrv-c9v3 / GHSA-85c8-ppgw-ccpr (`node_modules/tinypool`).
2. **`vitest` (<3.2.6)**: GHSA-5xrq-8626-4rwp (`node_modules/vitest`).

**Production Audit Status:**
Both critical vulnerabilities are strictly contained in development test runner dependencies (`devDependencies: vitest`). As confirmed by `npm audit --omit=dev`, **neither vulnerability is included in production dependencies or runtime artifacts (0 critical findings in `--omit=dev`)**.

## Phase 8 Requirement Note
> [!IMPORTANT]
> **Phase 8 Definition of Done Requirement:**
> 0 critical; 1 high is an approved, documented exception (PostCSS build tooling within Next.js); 5 moderate in pinned @solana/web3.js 1.x dependencies. All documented with feature-usage analysis in SECURITY.md.
