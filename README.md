# TrickleSettle

> **DePIN Micro-Settlement Batching Engine for Solana DevNet**  
> Queues high-frequency device events durably in SQLite, aggregates them into provably reconciled settlement batches on Solana DevNet, gracefully survives network outages and process crashes, and provides live mathematical reconciliation proofs.

[![Tests](https://img.shields.io/badge/tests-109%20passed-brightgreen)](TESTS.md)
[![Security Policy](https://img.shields.io/badge/security-S1--S20%20verified-blue)](SECURITY.md)
[![Known Limits](https://img.shields.io/badge/limits-documented-orange)](KNOWN_LIMITS.md)

**Documentation & Policy Links:**
- [SECURITY.md](SECURITY.md) — Threat model, security checklist S1–S20, dependency audit, and approved exceptions.
- [TESTS.md](TESTS.md) — Complete test inventory, chaos tests, burst load tests, and 3-run verification.
- [KNOWN_LIMITS.md](KNOWN_LIMITS.md) — DevNet scope, single-host model, simulated hardware, and test history limits.
- [docs/demo-script.md](docs/demo-script.md) — 90-second step-by-step presentation script with exact commands.

---

## What It Is (In Plain Language)

Physical devices like EV chargers, IoT sensors, or telecom hotspots generate thousands of tiny usage events every minute. Paying a separate transaction fee on Solana for each 1-cent micro-session is cost-prohibitive and fragile during RPC outages.

**TrickleSettle** acts as a durable reliability buffer:
1. **Durable Local Ingestion**: Accepts Ed25519-signed events from devices instantly into an atomic, local SQLite queue (<15ms latency).
2. **Batch Settlement**: Aggregates hundreds of micro-sessions into single on-chain transfer transactions on Solana DevNet, drastically reducing network fees.
3. **Outage Resilience**: If Solana RPC endpoints go down, incoming sessions continue to be accepted and queued safely without data loss. When connectivity restores, settlements resume automatically.
4. **Mathematical Conservation**: Automatically verifies that every single ingested event is accounted for exactly once ($\text{Lost} = 0, \text{Duplicates} = 0$).

---

## Architectural & Deployment Model

> [!IMPORTANT]
> **Single Host Deployment Only:**  
> TrickleSettle is designed for deployment on a **single host** (a local developer machine or single VM). Two processes—the Next.js API/dashboard server and the background settlement worker—share a single SQLite database in WAL (`Write-Ahead Logging`) mode. It is **NOT** designed for serverless or multi-server deployments.

> [!WARNING]
> **DevNet Only — Not for Real Funds:**  
> This project is strictly restricted to **Solana DevNet**. It verifies genesis hashes at boot and refuses to start on mainnet.

---

## Quick Start (6 Steps)

### 1. Prerequisites
- Node.js v20+ or v22+
- npm v10+

### 2. Installation & Environment
Clone the repository and install dependencies:

```bash
npm install
```

> [!NOTE]
> `npm install` reports critical findings in development tooling (`vitest@2.1.9` and `tinypool@1.1.1`). These packages are excluded by `npm install --omit=dev` and are not part of the production runtime. `npm audit --omit=dev` reports 0 critical and 6 findings (5 moderate, 1 high) in runtime dependencies. The high finding is an approved exception for postcss inside `next@15.5.29` (build-time CSS only). See [SECURITY.md](SECURITY.md) for the full threat assessment.

Copy the example environment configuration to `.env.local`:
- **macOS / Linux:**
  ```bash
  cp .env.example .env.local
  ```
- **Windows (PowerShell):**
  ```powershell
  Copy-Item .env.example .env.local
  ```
- **Windows (Command Prompt / cmd):**
  ```cmd
  copy .env.example .env.local
  ```

### 3. Generate Treasury Keypair
Generate the server-held DevNet settlement treasury keypair:
```bash
npm run keygen
```
This writes the keypair to `keys/treasury.json` and prints the public address.

> **Fund the Treasury (DevNet SOL):**  
> Request 1–2 DevNet SOL for the treasury address using the official faucet:  
> Visit [https://faucet.solana.com/](https://faucet.solana.com/) or run:  
> `solana airdrop 1 <TREASURY_PUBLIC_ADDRESS> --url devnet`

### 4. Seed Database & Device Identities
Initialize the SQLite schema, create the demo business, and register three simulated chargers:
```bash
npm run seed
```

### 5. Start the System
Open two terminal windows:

**Terminal 1 — Settlement Worker:**
```bash
npm run worker
```

**Terminal 2 — Operator Console (Next.js Dashboard):**
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

Run `npm run sim` for a few seconds, then refresh the dashboard at http://localhost:3000 to see live events and settlement. A fresh clone starts with 0 events by design.

### 6. Start Device Simulator
**Terminal 3 — Device Traffic:**
```bash
npm run sim -- --mode=normal --count=20 --interval=1000
```
Watch the sessions appear in real time on the dashboard, get batched by the worker, and settle on Solana DevNet.

---

## Outage & Recovery Demo

To verify resilience during an RPC disruption:

1. **Start normal device traffic:**
   ```bash
   npm run sim -- --mode=normal --count=30 --interval=1000
   ```
2. **Inject Outage:** In the web console, under **RPC Circuit Breaker & Chaos Controls**, click **"Simulate Outage"**.
3. **Observe Ingest:** The primary RPC indicator turns red (`DOWN`). The **Waiting** counter rises as devices continue recording sessions with zero HTTP rejections.
4. **Restore Network:** Click **"Restore Network"**.
5. **Automatic Catch-up:** The circuit breaker closes, the worker builds a fresh settlement batch with a new blockhash, and the **Waiting** counter drains to 0.
6. **Verify Proof:** Check the **Conservation** card (`Lost: 0`) and click the newly generated Solana Explorer link.

For a timed walkthrough, refer to [docs/demo-script.md](docs/demo-script.md).

---

## Stopping Safely

TrickleSettle guarantees state persistence before any external action.

To shut down gracefully, **always stop the worker first, then the web app**:
1. **Stop the Settlement Worker First:** Press `Ctrl+C` once in the worker terminal. The worker stops accepting new batches, finishes any in-flight transaction step, executes an atomic SQLite `TRUNCATE` checkpoint to merge the `-wal` file back into the main database, and exits with code 0.
2. **Stop the Web App Second:** Press `Ctrl+C` in the Next.js development server terminal.

*If restarted after an abrupt kill (`SIGKILL`), the worker resumes pending unconfirmed batches and validates them on-chain before processing new batches.*

---

## Useful Commands

| Command | Description |
|---|---|
| `npm run dev` | Starts Next.js development web server (port 3000) |
| `npm run worker` | Starts the background Solana settlement worker |
| `npm run sim` | Generates realistic Ed25519-signed charger sessions |
| `npm run backup` | Writes an atomic, timestamped copy of `data/trickle.db` to `backups/` using SQLite `VACUUM INTO` |
| `npm run report` | Generates a plain-English system audit and reconciliation report |
| `npm test` | Runs the full Vitest test suite (109 tests across 34 suites) |
| `npm audit --omit=dev` | Scans production dependencies for vulnerabilities |
