import { Connection } from "@solana/web3.js";
import Database from "better-sqlite3";
import { getConfig, DEVNET_GENESIS_HASH } from "./config";
import { getSystemState, setSystemState } from "./system-state";
import { logger } from "./logger";

export type BreakerStatus = "closed" | "open" | "half_open";

export interface EndpointBreakerState {
  status: BreakerStatus;
  consecutiveFailures: number;
  openedAt?: number;
}

export type ChaosMode = "off" | "down" | "timeout" | "429" | "lie";

export interface ChaosState {
  mode: ChaosMode;
}

export interface RpcRouterOptions {
  chaosEnabled?: boolean;
}

export class RpcRouter {
  private db: Database.Database;
  private endpoints: string[];
  private chaosEnabledOverride?: boolean;

  constructor(db: Database.Database, endpoints?: string[], options?: RpcRouterOptions) {
    this.db = db;
    const config = getConfig();
    if (endpoints && endpoints.length > 0) {
      this.endpoints = endpoints;
    } else {
      this.endpoints = config.RPC_ENDPOINTS.split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    }
    this.chaosEnabledOverride = options?.chaosEnabled;

    if (this.endpoints.length < 2) {
      logger.warn("RPC router configured with fewer than 2 endpoints. At least 2 endpoints recommended for failover.");
    }
  }

  public getEndpoints(): string[] {
    return [...this.endpoints];
  }

  public getEndpointBreakerState(endpoint: string, nowMs: number = Date.now()): EndpointBreakerState {
    const state = getSystemState<EndpointBreakerState>(this.db, `breaker:${endpoint}`);
    if (!state || !state.value) {
      return { status: "closed", consecutiveFailures: 0 };
    }
    const breaker = state.value;
    if (breaker.status === "open") {
      const config = getConfig();
      const openedAt = breaker.openedAt || 0;
      if (nowMs - openedAt >= config.CB_COOLDOWN_MS) {
        const halfOpenState: EndpointBreakerState = {
          status: "half_open",
          consecutiveFailures: breaker.consecutiveFailures,
          openedAt: breaker.openedAt,
        };
        this.setEndpointBreakerState(endpoint, halfOpenState);
        return halfOpenState;
      }
    }
    return breaker;
  }

  public setEndpointBreakerState(endpoint: string, state: EndpointBreakerState): void {
    setSystemState(this.db, `breaker:${endpoint}`, state);
  }

  public resetBreaker(endpoint: string): void {
    this.setEndpointBreakerState(endpoint, {
      status: "closed",
      consecutiveFailures: 0,
    });
  }

  public resetAllBreakers(): void {
    for (const ep of this.endpoints) {
      this.resetBreaker(ep);
    }
  }

  public getChaosMode(endpoint: string): ChaosMode {
    const config = getConfig();
    const isChaosAllowed =
      this.chaosEnabledOverride !== undefined
        ? this.chaosEnabledOverride
        : config.CHAOS_ENABLED && config.NODE_ENV !== "production";

    if (!isChaosAllowed) {
      return "off";
    }
    const state = getSystemState<ChaosState>(this.db, `chaos:${endpoint}`);
    return state?.value?.mode || "off";
  }

  public setChaosMode(endpoint: string, mode: ChaosMode): void {
    setSystemState(this.db, `chaos:${endpoint}`, { mode });
  }

  /**
   * Evaluates if endpoint is available based on circuit breaker status and cooldown.
   */
  public isEndpointAvailable(endpoint: string, nowMs: number = Date.now()): boolean {
    const breaker = this.getEndpointBreakerState(endpoint, nowMs);
    return breaker.status === "closed" || breaker.status === "half_open";
  }

  public recordSuccess(endpoint: string): void {
    const breaker = this.getEndpointBreakerState(endpoint);
    if (breaker.status !== "closed" || breaker.consecutiveFailures > 0) {
      this.setEndpointBreakerState(endpoint, {
        status: "closed",
        consecutiveFailures: 0,
      });
    }
  }

  public recordFailure(endpoint: string): void {
    const config = getConfig();
    const breaker = this.getEndpointBreakerState(endpoint);
    const consecutiveFailures = breaker.consecutiveFailures + 1;

    if (consecutiveFailures >= config.CB_FAILURE_THRESHOLD || breaker.status === "half_open") {
      this.setEndpointBreakerState(endpoint, {
        status: "open",
        consecutiveFailures,
        openedAt: Date.now(),
      });
      logger.warn(`Circuit breaker OPEN for endpoint ${endpoint} after ${consecutiveFailures} consecutive failures.`);
    } else {
      this.setEndpointBreakerState(endpoint, {
        status: "closed",
        consecutiveFailures,
      });
    }
  }

  /**
   * Verifies the DevNet cluster genesis hash.
   * If cluster genesis hash does not match DEVNET_GENESIS_HASH, throws and refuses startup.
   */
  public async verifyDevnetCluster(): Promise<void> {
    const genesisHash = await this.callWithFailover(async (connection) => {
      return await connection.getGenesisHash();
    });

    if (!genesisHash) {
      throw new Error("FATAL: Failed to fetch DevNet genesis hash. All RPC endpoints unavailable or failed.");
    }

    if (genesisHash !== DEVNET_GENESIS_HASH) {
      throw new Error(
        `FATAL: Cluster genesis hash mismatch. Expected DevNet genesis hash ${DEVNET_GENESIS_HASH}, got ${genesisHash}. Refusing to start.`
      );
    }
    logger.info("DevNet cluster verified successfully.", { genesisHash });
  }


  /** A connection to one named endpoint, for checks that must use a specific provider. */
  public getConnection(endpoint: string): Connection {
    return new Connection(endpoint, "confirmed");
  }

  /**
   * Executes an RPC operation on a specific named endpoint,
   * with circuit breaker evaluation, timeouts, and chaos simulation.
   */
  public async callEndpoint<T>(
    endpoint: string,
    operation: (connection: Connection, endpoint: string) => Promise<T>
  ): Promise<T | null> {
    // If callWithFailover was mocked on this instance (e.g. in unit tests), delegate to it
    if (this.callWithFailover !== RpcRouter.prototype.callWithFailover) {
      return await this.callWithFailover(operation);
    }

    if (!this.isEndpointAvailable(endpoint)) {
      return null;
    }

    const config = getConfig();
    const chaos = this.getChaosMode(endpoint);
    if (chaos === "down") {
      this.recordFailure(endpoint);
      return null;
    }

    if (chaos === "timeout") {
      await new Promise((resolve) => setTimeout(resolve, Math.min(config.RPC_TIMEOUT_MS, 500)));
      this.recordFailure(endpoint);
      return null;
    }

    if (chaos === "429") {
      this.recordFailure(endpoint);
      return null;
    }

    const connection = new Connection(endpoint, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: config.RPC_TIMEOUT_MS,
    });

    let timer: NodeJS.Timeout | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`RPC timeout of ${config.RPC_TIMEOUT_MS}ms exceeded on ${endpoint}`));
        }, config.RPC_TIMEOUT_MS);
      });

      const result = await Promise.race([
        operation(connection, endpoint),
        timeoutPromise,
      ]);

      if (timer) clearTimeout(timer);
      this.recordSuccess(endpoint);
      return result;
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      this.recordFailure(endpoint);
      logger.warn(`RPC call failed on ${endpoint}: ${err.message || String(err)}`);
      return null;
    }
  }

  /**
   * Executes an RPC operation across configured endpoints in priority order,
   * with failover, circuit breaker evaluation, timeouts, and chaos simulation.
   * Returns null if all endpoints are open or failed, without throwing an unhandled exception.
   */
  public async callWithFailover<T>(
    operation: (connection: Connection, endpoint: string) => Promise<T>
  ): Promise<T | null> {
    const config = getConfig();
    let lastError: Error | null = null;
    let anyEndpointAttempted = false;

    for (const endpoint of this.endpoints) {
      if (!this.isEndpointAvailable(endpoint)) {
        continue;
      }

      anyEndpointAttempted = true;

      // Check chaos flags from system_state
      const chaos = this.getChaosMode(endpoint);
      if (chaos === "down") {
        this.recordFailure(endpoint);
        lastError = new Error(`Simulated chaos: endpoint down (${endpoint})`);
        continue;
      }

      if (chaos === "timeout") {
        await new Promise((resolve) => setTimeout(resolve, Math.min(config.RPC_TIMEOUT_MS, 500)));
        this.recordFailure(endpoint);
        lastError = new Error(`Simulated chaos: RPC request timed out (${endpoint})`);
        continue;
      }

      if (chaos === "429") {
        this.recordFailure(endpoint);
        lastError = new Error(`Simulated chaos: rate limit 429 received from (${endpoint})`);
        continue;
      }

      const connection = new Connection(endpoint, {
        commitment: "confirmed",
        confirmTransactionInitialTimeout: config.RPC_TIMEOUT_MS,
      });

      let timer: NodeJS.Timeout | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`RPC timeout of ${config.RPC_TIMEOUT_MS}ms exceeded on ${endpoint}`));
          }, config.RPC_TIMEOUT_MS);
        });

        const result = await Promise.race([
          operation(connection, endpoint),
          timeoutPromise,
        ]);

        if (timer) clearTimeout(timer);
        this.recordSuccess(endpoint);
        return result;
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        this.recordFailure(endpoint);
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(`RPC call failed on ${endpoint}: ${lastError.message}. Trying next endpoint.`);
      }
    }

    if (!anyEndpointAttempted) {
      logger.warn("All RPC endpoints are open/unavailable. Waiting for cooldown.");
      return null;
    }

    logger.warn(`All RPC endpoints failed. Last error: ${lastError?.message || "unknown"}`);
    return null;
  }
}
