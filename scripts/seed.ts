import fs from "fs";
import path from "path";
import crypto from "crypto";
import nacl from "tweetnacl";
import { getDb } from "../src/lib/db";
import { migrate } from "../db/migrate";

export function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

export function seed() {
  loadEnvLocal();
  const db = getDb();
  migrate(db);

  const keysDir = path.resolve(process.cwd(), "keys/devices");
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }

  const now = Date.now();

  const businessId = "biz_demo_01";
  const businessName = "Metro EV Charging Network";
  const rawApiKey = "ts_live_demo_apikey_883921";
  const apiKeyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");

  // Insert business
  db.prepare(`
    INSERT OR REPLACE INTO businesses (id, name, api_key_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(businessId, businessName, apiKeyHash, now);

  // Payees
  const payee1Id = "payee_charger_site_1";
  const payee1Address = "25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr";
  const payee2Id = "payee_charger_site_2";
  const payee2Address = "25evxBYTgpxRta9DSaWhARHtfqu7aAHf6rtAqp2o8HCr";

  db.prepare(`
    INSERT OR REPLACE INTO payees (id, business_id, label, solana_address, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(payee1Id, businessId, "Downtown Fast-Charger Site 1", payee1Address, now);

  db.prepare(`
    INSERT OR REPLACE INTO payees (id, business_id, label, solana_address, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(payee2Id, businessId, "Suburban Hub Site 2", payee2Address, now);

  // 3 Devices with Ed25519 keypairs
  const devices = [
    { id: "dev_charger_001", payeeId: payee1Id },
    { id: "dev_charger_002", payeeId: payee1Id },
    { id: "dev_charger_003", payeeId: payee2Id },
  ];

  for (const dev of devices) {
    const keypair = nacl.sign.keyPair();
    const publicKeyBase64 = Buffer.from(keypair.publicKey).toString("base64");
    const secretKeyBase64 = Buffer.from(keypair.secretKey).toString("base64");

    // Store private key safely in gitignored keys/devices/<id>.json
    const keyFilePath = path.join(keysDir, `${dev.id}.json`);
    fs.writeFileSync(
      keyFilePath,
      JSON.stringify(
        {
          deviceId: dev.id,
          publicKey: publicKeyBase64,
          secretKey: secretKeyBase64,
        },
        null,
        2
      )
    );

    // Insert device row (public key only)
    db.prepare(`
      INSERT OR REPLACE INTO devices (id, business_id, payee_id, public_key, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(dev.id, businessId, dev.payeeId, publicKeyBase64, now);
  }

  return {
    businessId,
    businessName,
    rawApiKey,
    apiKeyHash,
    payees: [payee1Id, payee2Id],
    devices: devices.map((d) => d.id),
  };
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  const result = seed();
  console.log("Seeding completed successfully.");
  console.log(`Business ID: ${result.businessId}`);
  console.log(`Demo API Key (raw, not stored): ${result.rawApiKey}`);
  console.log(`API Key Hash (stored): ${result.apiKeyHash}`);
  console.log(`Payees seeded: ${result.payees.length}`);
  console.log(`Devices seeded: ${result.devices.join(", ")}`);
}
