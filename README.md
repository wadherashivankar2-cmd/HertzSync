# TrickleSettle

**One-line:** TrickleSettle is a reliability layer between a business's device or usage events and Solana DevNet. It queues events durably, pays in batches, survives outages, and proves every payment reconciles.

> [!IMPORTANT]
> **DevNet Only:** This project is built strictly for Solana DevNet. It refuses to connect to mainnet. It is not designed for real funds or custody.

> [!NOTE]
> **Single Host Deployment:** TrickleSettle is designed for deployment on a single host (local machine or a single VM). Two processes—the Next.js web application and the settlement worker—share a single SQLite database in WAL mode. It is NOT designed for serverless environments.
