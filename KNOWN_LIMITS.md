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

