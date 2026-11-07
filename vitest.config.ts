import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    env: {
      CLUSTER: "devnet",
      RPC_ENDPOINTS: "https://api.devnet.solana.com,https://devnet.helius-rpc.com",
      ADMIN_API_KEY: "test_admin_key_vitest",
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
