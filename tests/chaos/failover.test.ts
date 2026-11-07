import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RpcRouter } from "../../src/lib/rpc-router";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";

describe("RPC Router Failover and Timeout Chaos (Phase 3)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  const ep1 = "https://failing-endpoint-1.devnet.solana.com";
  const ep2 = "https://healthy-endpoint-2.devnet.solana.com";

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  });

  it("endpoint 1 timing out; call succeeds via endpoint 2", async () => {
    const router = new RpcRouter(db, [ep1, ep2], { chaosEnabled: true });

    // Set endpoint 1 to 'timeout' chaos mode
    router.setChaosMode(ep1, "timeout");

    const attemptedEndpoints: string[] = [];
    const result = await router.callWithFailover(async (_conn, endpoint) => {
      attemptedEndpoints.push(endpoint);
      if (endpoint === ep2) {
        return "success_from_ep2";
      }
      throw new Error(`Unexpected call to ${endpoint}`);
    });

    expect(result).toBe("success_from_ep2");
    // ep1 was handled by chaos timeout (recorded failure), ep2 was called and succeeded
    expect(attemptedEndpoints).toEqual([ep2]);

    const ep1Breaker = router.getEndpointBreakerState(ep1);
    expect(ep1Breaker.consecutiveFailures).toBe(1);

    const ep2Breaker = router.getEndpointBreakerState(ep2);
    expect(ep2Breaker.status).toBe("closed");
    expect(ep2Breaker.consecutiveFailures).toBe(0);
  });

  it("trips breaker on endpoint 1 after 3 timeouts and routes future calls directly to endpoint 2", async () => {
    const router = new RpcRouter(db, [ep1, ep2], { chaosEnabled: true });
    router.setChaosMode(ep1, "timeout");

    // 1st failure
    await router.callWithFailover(async () => "ok");
    expect(router.getEndpointBreakerState(ep1).consecutiveFailures).toBe(1);

    // 2nd failure
    await router.callWithFailover(async () => "ok");
    expect(router.getEndpointBreakerState(ep1).consecutiveFailures).toBe(2);

    // 3rd failure: trips breaker open
    await router.callWithFailover(async () => "ok");
    const ep1State = router.getEndpointBreakerState(ep1);
    expect(ep1State.status).toBe("open");
    expect(ep1State.consecutiveFailures).toBe(3);

    // Next call: ep1 is skipped immediately because its breaker is open
    const calls: string[] = [];
    const res = await router.callWithFailover(async (_conn, endpoint) => {
      calls.push(endpoint);
      return "fast_ep2";
    });

    expect(res).toBe("fast_ep2");
    expect(calls).toEqual([ep2]);
  });
});

