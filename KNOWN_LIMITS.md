# Known Limitations

This document records the architectural and operational limitations of the TrickleSettle DevNet prototype.

### RPC Failover & Provider Redundancy
- **RPC Endpoint Verification:** Failover was verified with mock endpoints in tests, and against one real DevNet endpoint, not two independent real RPC providers.
- **Shared Provider Fate:** Public or private RPC providers may share common underlying network infrastructure, upstream validators, or cluster-wide congestion, meaning an outage on one provider may correlate with outages on others.

### Blockchain & Network Scope
- **DevNet Only:** TrickleSettle is built and guarded exclusively for Solana DevNet. It refuses to connect to Solana mainnet-beta.
- **Not Audited:** This codebase is a prototype for demonstration and testing purposes. It has not undergone an independent security audit and is not intended for custody or transmission of real financial assets.

### Hardware & Environment
- **Simulated Hardware:** Tested with simulated software devices generating Ed25519 signatures. Embedded hardware secure elements and physical power loss scenarios were not tested on physical hardware.
- **Single Host Deployment:** TrickleSettle is designed strictly for a single host where the Next.js API process and the background settlement worker share a single SQLite database file in WAL mode. It does not support multi-instance horizontal scaling or serverless environments.

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
  - Static memo text `TESTHASH01` was also broadcast across early Phase 3 live transfer test runs prior to ULID and dynamic events hash generation.

