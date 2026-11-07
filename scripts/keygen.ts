import { Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";

/**
 * Treasury Keypair Generator.
 * Blueprint Section 2.3, 7.1 (S5), Phase 3 step 5.
 *
 * Generates a standard Solana keypair for the settlement treasury,
 * saves it to `keys/treasury.json`, and outputs ONLY the public address.
 * NEVER prints private key bytes.
 */
export function generateOrLoadTreasuryKey(filePath: string = "./keys/treasury.json", force: boolean = false): Keypair {
  const fullPath = path.resolve(process.cwd(), filePath);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  if (fs.existsSync(fullPath) && !force) {
    try {
      const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (Array.isArray(data) && data.length === 64) {
        return Keypair.fromSecretKey(Uint8Array.from(data));
      }
    } catch {
      // If corrupted and regeneration not blocked, proceed to create new
    }
  }

  const keypair = Keypair.generate();
  const secretKeyArray = Array.from(keypair.secretKey);

  fs.writeFileSync(fullPath, JSON.stringify(secretKeyArray), {
    encoding: "utf8",
    mode: 0o600,
  });

  return keypair;
}

if (process.argv[1] && process.argv[1].endsWith("keygen.ts")) {
  const force = process.argv.includes("--force");
  const keyPath = process.env.TREASURY_KEYPAIR_PATH || "./keys/treasury.json";
  const keypair = generateOrLoadTreasuryKey(keyPath, force);

  console.log("=== Solana DevNet Treasury Wallet ===");
  console.log(`Public Address: ${keypair.publicKey.toBase58()}`);
  console.log(`Saved Key File: ${keyPath}`);
  console.log("Network: Solana DevNet");
  console.log("=====================================");
}

