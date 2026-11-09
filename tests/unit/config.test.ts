import { describe, it, expect } from "vitest";
import { parseConfig, DEVNET_GENESIS_HASH } from "../../src/lib/config";

describe("Configuration and Guardrails", () => {
  const validDevnetEnv = {
    CLUSTER: "devnet",
    RPC_ENDPOINTS: "https://api.devnet.solana.com,https://solana-devnet.gateway.tatum.io",
    ADMIN_API_KEY: "test_admin_key",
    NODE_ENV: "test",
  };

  it("should parse valid devnet config successfully", () => {
    const config = parseConfig(validDevnetEnv);
    expect(config.CLUSTER).toBe("devnet");
    expect(DEVNET_GENESIS_HASH).toBeDefined();
    expect(config.RATE_LIMIT_PER_MIN).toBe(600);
    expect(config.BATCH_MAX_EVENTS).toBe(100);
  });

  it("should throw when CLUSTER is mainnet-beta or anything other than devnet", () => {
    const mainnetEnv = {
      ...validDevnetEnv,
      CLUSTER: "mainnet-beta",
    };

    expect(() => parseConfig(mainnetEnv)).toThrowError(/CLUSTER must be 'devnet'/);
  });

  it("should throw when required variables are missing", () => {
    const missingEndpointsEnv = {
      CLUSTER: "devnet",
      ADMIN_API_KEY: "test_admin_key",
    };

    expect(() => parseConfig(missingEndpointsEnv as any)).toThrowError(/RPC_ENDPOINTS is required/);
  });
});
