# Known Limitations

This document records the architectural and operational limitations of the HertzSync DevNet prototype.

### RPC Failover & Provider Redundancy
- **RPC Endpoint Verification:** Failover was verified with mock endpoints in tests, and against one real DevNet endpoint, not two independent real RPC providers.
- **Shared Provider Fate:** Public or private RPC providers may share common underlying network infrastructure, upstream validators, or cluster-wide congestion, meaning an outage on one provider may correlate with outages on others.

### Blockchain & Network Scope
- **DevNet Only:** HertzSync is built and guarded exclusively for Solana DevNet. It refuses to connect to Solana mainnet-beta.
- **Not Audited & Approved Audit Exception:** This codebase is a prototype for demonstration and testing purposes. It has not undergone an independent security audit and is not intended for custody or transmission of real financial assets. Dependency scanning (`npm audit --omit=dev`) contains one documented approved exception for `postcss <=8.5.22` (internal to Next.js build-time CSS compilation; zero critical findings).
- **Throwaway Test Transfers & Per-Database Scoping:** 14 live transfers went to throwaway addresses (funds not recoverable, DevNet only), and duplicate detection inside the app is per database. Cross-run uniqueness is checked against the chain.

### Hardware & Environment
- **Simulated Hardware:** Tested with simulated software devices generating Ed25519 signatures. Embedded hardware secure elements and physical power loss scenarios were not tested on physical hardware.
- **Single Host Deployment:** HertzSync is designed strictly for a single host where the Next.js API process and the background settlement worker share a single SQLite database file in WAL mode. It does not support multi-instance horizontal scaling or serverless environments.

### Custody & Sybil Resistance
- **Server-Held Treasury:** The settlement treasury private key is held locally on the host filesystem (`keys/treasury.json`) rather than in a Hardware Security Module (HSM) or multi-signature vault.
- **No Inherent Sybil Resistance:** Device authentication is verified via per-device Ed25519 public keys mapped to businesses, but on-chain sybil resistance or identity verification is out of scope.

### Cross-Run Uniqueness & Historical Test Fixture Repeats
- **Throwaway Test Transfers & Per-Database Scoping:** 14 live transfers went to throwaway addresses (funds not recoverable, DevNet only), and duplicate detection inside the app is per database. Cross-run uniqueness is checked against the chain by step 2.
- **Historical On-Chain Events Hash Repeats Prior to Run-ID Fix:** Prior to the introduction of per-run random IDs in test fixtures (Item 1), test fixtures used hardcoded event IDs (`ev_crash_1..3` and `ev_outage_live_1..10`), causing deterministic events hashes to be broadcast multiple times across consecutive test suite runs:
  - Events Hash `3cce3bad06dd5e9964395dde619a8802066f3220d9e6d884368f889db355b6e8` repeated across 5 confirmed batches:
    * Row 14: `2pTrDUu6dv7g3QXQxYDKYCTj9UNpRxnUK2tigpnK2G1wgAzBoPvMV5D9UsHaHg6ch7tQeQ5DJjY3GbAvuCHQv6kT` (batch `01M6V4D4WM9NXZAXDDXV79F7JY`)
    * Row 16: `9sAhSTEyuQdEv49doV3oQRdGM6cvJYA4cGDBTEwxkujaPMTfZimRLwt3Lzk5jxCKjCsVzuhP51QbAcic61vpiyj` (batch `01M6V4TTKDH9GP94J0BWWCCQCJ`)
    * Row 25: `5QudjNhRyUNNPM3sCVAbEe4YLahdLqzEBvEXSo4SRrEjtBesNKkqk3gHoR7P8u5oqooar53dXsovn93MPA3DagKE` (batch `01M6V6E989X8TFG3E6ST64G0BW`)
    * Row 27: `3cLKWXGkgV2QSVLwmMSLjd8GvuaffHDrwRgLgujx5b3DKFrcEfABJ92BXXvM1iRHPbZrbY8RFmTSw9FYEb5i6pop` (batch `01M6V6JDHQWQ3P856MBR00Z9BV`)
    * Row 31: `3rxeuM4JV4PjorGFqfNY8XP5odr6gfe41LWjTCrktUXNDwybfADk5o2ncYEZBwc8detkLziduSxJ9puq5jKGo3gG` (batch `01M6V84YCTFY3M6NX4P7TWDBNB`)
  - Events Hash `4cb435ff789959db025e1dfe3e42d6101ef19f8c2c6ea2a1511158f838d07de6` repeated across 4 confirmed batches:
    * Row 23: `4V3VqZnkX4SpwPm9hGNAAukEmmGVLazzujkfttp6d8zTQgAozADhhwgsPDMh2w4CRcCJsNuVCPHD86vjxa9tuUKP` (batch `01M6V67G0V0EVXM07F6JTM4A2N`)
    * Row 24: `vmsb5xC1AqRvebwFGQuAVuar997TJCqQrvuyNhCQAZ1BLiC27sdA7T6XegcYZaVjxL46QNHw3FGDfCLjnUjXWLw` (batch `01M6V6B2JRRKHNESVWVH6DWTRQ`)
    * Row 28: `kQ4czauJ9fuZdBZeBmetA8jznKNfpPM47PVkpXm7JZyHxYePAAuAVtDiAuFwzifV78S861q4LnEyXwY9TthmKHS` (batch `01M6V6JBHX80M80YFW42S5P1S5`)
    * Row 32: `65MEYbkr2jjCn13DFpx5qMfJ2F7mK9ykNZgNVj3Wbn3ZovNo4nyfvUGmXXN5BFEEvzyq29JKXCF5o4P9Zrs5kzM2` (batch `01M6V84WJQRHJQVK1N9ENXXNSV`)
### Phase 5 Live Test Transactions (Pre-Skip Fix)
- **Fee-Only Live Test Transactions:** During initial Phase 5 development and test runs prior to extending the zero-transfer skip guard across all live suites, 9 fee-only live transactions were broadcast to Solana DevNet across 3 test runs:
  * 3 self-payee transfers from `tests/integration/solana-devnet.test.ts`
  * 3 crash recovery batches from `tests/chaos/crash-midbatch.test.ts`
  * 3 outage recovery batches from `tests/chaos/outage.test.ts`
  All 9 transactions sent funds directly to the treasury itself (`25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr`), incurring net expenses of exactly 5,000 lamports per transaction in network fees (total: 45,000 lamports, reducing treasury balance from 485,800,000 to 485,755,000 lamports).
  The `MAX_LIVE_TRANSFERS_PER_TEST_RUN=0` skip guard is now strictly enforced across `solana-devnet.test.ts`, `crash-midbatch.test.ts`, and `outage.test.ts`, ensuring zero network broadcasts occur when configured for local/mocked execution.

### Phase 6 Demo Database Reset & Counter Transition
- **Database Reset for Final Demo Run:** Prior to capturing the final operator console verification evidence in Phase 6, `data/trickle.db` was completely reset and re-seeded using `scripts/seed.ts` to establish a clean baseline.
- **Why Received Events Dropped from 40 to 20:** The previous count of 40 events in `data/trickle.db` included 20 mocked/synthetic rows created during initial UI layout testing. The database reset wiped those synthetic entries. The system was then re-seeded with exactly 20 legitimate Ed25519-signed device events, which were batched and confirmed live on Solana DevNet across two on-chain settlement transactions (signatures `3CLNQ4Lrk...` and `5hC4U8koz...`). Consequently, `Received Events` derived from `SELECT COUNT(*) FROM events` accurately transitioned from the preliminary 40 to the genuine 20 confirmed events.

