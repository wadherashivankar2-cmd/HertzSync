# TrickleSettle

**One-line:** TrickleSettle is a reliability layer between a business's device or usage events and Solana DevNet. It queues events durably, pays in batches, survives outages, and proves every payment reconciles.

> [!IMPORTANT]
> **DevNet Only:** This project is built strictly for Solana DevNet. It refuses to connect to mainnet. It is not designed for real funds or custody.

> [!NOTE]
> **Single Host Deployment:** TrickleSettle is designed for deployment on a single host (local machine or a single VM). Two processes—the Next.js web application and the settlement worker—share a single SQLite database in WAL mode. It is NOT designed for serverless environments.

## Treasury Wallet Setup & DevNet Funding (Phase 3)

The settlement worker uses a dedicated treasury keypair stored at `keys/treasury.json` to pay settlement batches on Solana DevNet.

1. **Generate the Treasury Keypair:**
   ```bash
   npx tsx scripts/keygen.ts
   ```
   This generates `keys/treasury.json` and outputs the public address (never the private key).

2. **Fund the Treasury via the DevNet Faucet:**
   Manual funding via Solana CLI or Web Faucet is required (faucet requests are not automated):
   - **Using Solana CLI:**
     ```bash
     solana airdrop 1 <TREASURY_PUBLIC_ADDRESS> --url devnet
     ```
   - **Using Web Faucet:**
     Visit [https://faucet.solana.com/](https://faucet.solana.com/) or [https://solfaucet.com/](https://solfaucet.com/) and request DevNet SOL for your treasury address.

3. **Verify Balance:**
   ```bash
   solana balance <TREASURY_PUBLIC_ADDRESS> --url devnet
   ```
   Ensure the balance exceeds `TREASURY_MIN_LAMPORTS` (default: 100,000,000 lamports / 0.1 SOL) before running live settlement tests or the settlement worker.
