import { z } from "zod";

/**
 * Solana DevNet Cluster Genesis Hash
 * Value: EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
 *
 * Official documentation source:
 * https://docs.anza.xyz/clusters/available
 * The exact line on https://docs.anza.xyz/clusters/available appears under the Devnet section
 * in the validator command-line flags:
 * `--expected-genesis-hash EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG \`
 * Source code reference:
 * https://github.com/anza-xyz/agave/blob/master/sdk/src/genesis_config.rs (ClusterType::Devnet)
 */
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export const envSchema = z.object({
  CLUSTER: z.literal("devnet", {
    message: "FATAL: CLUSTER must be 'devnet'. Mainnet or any other cluster is strictly prohibited.",
  }),
  RPC_ENDPOINTS: z.string({ message: "RPC_ENDPOINTS is required" }).min(1, "RPC_ENDPOINTS is required"),
  TREASURY_KEYPAIR_PATH: z.string().default("./keys/treasury.json"),
  TREASURY_MIN_LAMPORTS: z.coerce.number().int().positive().default(100000000),
  DB_PATH: z.string().default("./data/trickle.db"),
  ADMIN_API_KEY: z.string({ message: "ADMIN_API_KEY is required" }).min(1, "ADMIN_API_KEY is required"),
  CHAOS_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  BATCH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  BATCH_MAX_EVENTS: z.coerce.number().int().positive().default(100),
  MAX_BATCH_LAMPORTS: z.coerce.number().int().positive().default(1000000000),
  MAX_EVENT_LAMPORTS: z.coerce.number().int().positive().default(100000000),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  MEMO_MAX_BYTES: z.coerce.number().int().positive().default(120),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  CB_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  CB_COOLDOWN_MS: z.coerce.number().int().positive().default(30000),
  RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(10000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Config = z.infer<typeof envSchema>;

export function parseConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const errorObj: any = result.error;
    const issues: any[] = errorObj?.issues || errorObj?.errors || [];
    const formattedErrors = issues
      .map((e: any) => `[${(e.path || []).join(".")}] ${e.message}`)
      .join("; ");
    throw new Error(`Configuration Error: ${formattedErrors}`);
  }
  return result.data;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = parseConfig(process.env);
  }
  return _config;
}
