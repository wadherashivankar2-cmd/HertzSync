# HertzSync 90-Second Demo Script

This script walks through the complete end-to-end HertzSync demonstration in 90 seconds, following **Blueprint Section 13**.

---

## Prerequisites & Setup

Open three terminal windows in the project directory:

```bash
# Terminal 1: Settlement Worker
npm run worker

# Terminal 2: Next.js Web Console
npm run dev

# Terminal 3: Device Traffic Simulator / CLI Commands
# (Keep ready to run traffic commands)
```

Open the dashboard in your browser: [http://localhost:3000](http://localhost:3000)

---

## The 90-Second Demo Sequence

### 0:00 - Initial State (All Green)
- **Visual**: Show the operator dashboard. All status indicators are green; RPC endpoints are `CLOSED` (healthy).
- **Say (Plain)**: *"Three chargers are sending sessions to a business's payment system."*
- **Say (Technical)**: *"Ingest is separate from Solana; the queue records first."*

---

### 0:15 - Normal Traffic Ingestion & Batch Settlement
- **Action**: In Terminal 3, send normal device traffic:
  ```bash
  npm run sim -- --mode=normal --count=10 --interval=500
  ```
- **Visual**: The dashboard shows **Received** and **Queued** counters incrementing. Shortly after, the worker packages them into a batch and broadcasts to DevNet. The batch moves from `Submitted` to `Confirmed`.
- **Say (Plain)**: *"Each session is recorded and then paid in small batches."*
- **Say (Technical)**: *"Batches carry a memo with the batch ID and an events hash."*

---

### 0:35 - Simulate Network Outage (Chaos Injection)
- **Action**: On the dashboard, locate the **RPC Circuit Breaker & Chaos Controls** card and click **"Simulate Outage"** (sets chaos mode to `down`).
- **Visual**: The primary endpoint status turns red (`DOWN`). The circuit breaker reflects the disruption.
- **Say (Plain)**: *"The payment network is down. Watch what keeps working."*
- **Say (Technical)**: *"The circuit breaker opens in shared state; ingest is unaffected."*

---

### 0:50 - Ingest Continues During Outage (Waiting Counter Rises)
- **Action**: In Terminal 3, send another wave of sessions during the outage:
  ```bash
  npm run sim -- --mode=normal --count=10 --interval=500
  ```
- **Visual**: Point at the **Waiting** counter rising on screen (from 0 to 10). The API accepts every session with HTTP 202 (`queued`), but the worker safely holds settlement until the network recovers.
- **Say (Plain)**: *"Nothing is lost. Sessions wait safely."*
- **Say (Technical)**: *"Events are durable in SQLite with unique keys."*

---

### 1:00 - Restore Network & Automatic Queue Drain
- **Action**: On the dashboard, click **"Restore Network"** (clears chaos mode back to `off`).
- **Visual**: The endpoint returns to green (`CLOSED`). The settlement worker immediately detects endpoint recovery, reads live DevNet balance, builds a fresh settlement batch with fresh blockhash, and submits to Solana. The **Waiting** counter drops to 0, and **Paid** rises.
- **Say (Plain)**: *"The network is back. Payments resume by themselves."*
- **Say (Technical)**: *"Pending batches resume; expired ones are rebuilt with a fresh blockhash; nothing is sent twice."*

---

### 1:15 - Live Mathematical Reconciliation Proof
- **Action**: Scroll to the **Conservation Audit & Reconciliation** card on the dashboard (or run `npm run report` in terminal).
- **Visual**: Show `Lost: 0` and `On-chain Duplicates: 0`. The conservation equation holds:
  $$\text{Generated} = \text{Queued} + \text{Batched} + \text{Paid} + \text{Flagged} + \text{Lost}$$
- **Say (Plain)**: *"Every session is accounted for, and nothing was paid twice."*
- **Say (Technical)**: *"Reconciliation checks on-chain memo hashes against stored events."*

---

### 1:25 - On-Chain Public Verification
- **Action**: Under the **Recent Settlement Batches** table, click the **Solana Explorer link** for the newly confirmed batch.
- **Visual**: Solana Explorer displays the transaction on DevNet:
  - Lamport transfer from treasury to payee address
  - SPL Memo instruction containing the batch ULID and SHA-256 events hash: `trickle:v1:<batch_id>:<events_hash>`
- **Say (Plain)**: *"Here is the proof on Solana's public test network."*
- **Say (Technical)**: *"The memo and transfer are visible in the transaction."*

---

## Stopping Safely

To shut down after the demo:
1. In Terminal 1 (worker): Press `Ctrl+C` once. The worker finishes its current step, performs an atomic `TRUNCATE` checkpoint on SQLite, and exits 0 cleanly.
2. In Terminal 2 (Next.js app): Press `Ctrl+C`.
