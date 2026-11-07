import { RpcRouter } from "../../src/lib/rpc-router";
import { createDatabaseConnection } from "../../src/lib/db";

const dbPath = process.env.DB_PATH;
if (!dbPath) {
  console.error("Missing DB_PATH environment variable");
  process.exit(1);
}

const db = createDatabaseConnection(dbPath);
const ep1 = process.env.TEST_EP1 || "https://mock-ep-1.devnet.solana.com";
const ep2 = process.env.TEST_EP2 || "https://mock-ep-2.devnet.solana.com";

const router = new RpcRouter(db, [ep1, ep2], { chaosEnabled: true });

async function run() {
  const selectedEndpoints: string[] = [];
  const result = await router.callWithFailover(async (_conn, endpoint) => {
    selectedEndpoints.push(endpoint);
    return `${endpoint}_selected`;
  });

  console.log(`WORKER_RESULT:${JSON.stringify({ result, selectedEndpoints })}`);
  db.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
