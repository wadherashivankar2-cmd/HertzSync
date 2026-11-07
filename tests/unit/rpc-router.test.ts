import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RpcRouter } from "../../src/lib/rpc-router";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";

describe("RpcRouter (Circuit Breaker and Failover)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  const ep1 = "https://mock-rpc-1.devnet.solana.com";
  const ep2 = "https://mock-rpc-2.devnet.solana.com";

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

  it("breaker opens after 3 failures", () => {
    const router = new RpcRouter(db, [ep1, ep2]);

    expect(router.getEndpointBreakerState(ep1).status).toBe("closed");
    expect(router.isEndpointAvailable(ep1)).toBe(true);

    router.recordFailure(ep1);
    expect(router.getEndpointBreakerState(ep1).status).toBe("closed");
    expect(router.getEndpointBreakerState(ep1).consecutiveFailures).toBe(1);

    router.recordFailure(ep1);
    expect(router.getEndpointBreakerState(ep1).status).toBe("closed");
    expect(router.getEndpointBreakerState(ep1).consecutiveFailures).toBe(2);

    router.recordFailure(ep1);
    const state = router.getEndpointBreakerState(ep1);
    expect(state.status).toBe("open");
    expect(state.consecutiveFailures).toBe(3);
    expect(state.openedAt).toBeDefined();
    expect(router.isEndpointAvailable(ep1)).toBe(false);
  });

  it("cooldown transitions open breaker to half-open", () => {
    const router = new RpcRouter(db, [ep1, ep2]);

    // Trip breaker to open
    router.recordFailure(ep1);
    router.recordFailure(ep1);
    router.recordFailure(ep1);
    expect(router.getEndpointBreakerState(ep1).status).toBe("open");

    // Before cooldown (e.g. 5 seconds after open), still open and unavailable
    const now = Date.now();
    expect(router.isEndpointAvailable(ep1, now + 5000)).toBe(false);
    expect(router.getEndpointBreakerState(ep1, now + 5000).status).toBe("open");

    // After cooldown period (30000ms by default), transitions to half-open
    const afterCooldown = now + 31000;
    expect(router.isEndpointAvailable(ep1, afterCooldown)).toBe(true);
    expect(router.getEndpointBreakerState(ep1, afterCooldown).status).toBe("half_open");
  });

  it("half-open success closes breaker", () => {
    const router = new RpcRouter(db, [ep1, ep2]);

    // Directly set breaker to half-open
    router.setEndpointBreakerState(ep1, {
      status: "half_open",
      consecutiveFailures: 3,
      openedAt: Date.now() - 35000,
    });
    expect(router.getEndpointBreakerState(ep1).status).toBe("half_open");

    // Record success while in half-open
    router.recordSuccess(ep1);

    const closedState = router.getEndpointBreakerState(ep1);
    expect(closedState.status).toBe("closed");
    expect(closedState.consecutiveFailures).toBe(0);
    expect(router.isEndpointAvailable(ep1)).toBe(true);
  });

  it("all-open does not throw and returns null", async () => {
    const router = new RpcRouter(db, [ep1, ep2]);

    // Set all configured endpoints to open
    router.setEndpointBreakerState(ep1, {
      status: "open",
      consecutiveFailures: 3,
      openedAt: Date.now(),
    });
    router.setEndpointBreakerState(ep2, {
      status: "open",
      consecutiveFailures: 3,
      openedAt: Date.now(),
    });

    expect(router.isEndpointAvailable(ep1)).toBe(false);
    expect(router.isEndpointAvailable(ep2)).toBe(false);

    // Calling callWithFailover when all endpoints are open must not throw
    let errorThrown: any = null;
    let result: any = undefined;
    try {
      result = await router.callWithFailover(async () => {
        return "unexpected_success";
      });
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).toBeNull();
    expect(result).toBeNull();
  });

  it("fails over to second endpoint when first endpoint throws an error", async () => {
    const router = new RpcRouter(db, [ep1, ep2]);

    let calledEndpoints: string[] = [];
    const res = await router.callWithFailover(async (_conn, endpoint) => {
      calledEndpoints.push(endpoint);
      if (endpoint === ep2) {
        return "ep2_success";
      }
      throw new Error("ep1 connection refused");
    });

    expect(res).toBe("ep2_success");
    expect(calledEndpoints).toEqual([ep1, ep2]);
    expect(router.getEndpointBreakerState(ep1).consecutiveFailures).toBe(1);
    expect(router.getEndpointBreakerState(ep2).status).toBe("closed");
  });

  it("fails over immediately when first endpoint has chaos 'down' mode", async () => {
    const router = new RpcRouter(db, [ep1, ep2], { chaosEnabled: true });
    router.setChaosMode(ep1, "down");

    let calledEndpoints: string[] = [];
    const res = await router.callWithFailover(async (_conn, endpoint) => {
      calledEndpoints.push(endpoint);
      return `${endpoint}_success`;
    });

    expect(res).toBe(`${ep2}_success`);
    expect(calledEndpoints).toEqual([ep2]); // ep1 was bypassed due to chaos down
    expect(router.getEndpointBreakerState(ep1).consecutiveFailures).toBe(1);
  });
});
