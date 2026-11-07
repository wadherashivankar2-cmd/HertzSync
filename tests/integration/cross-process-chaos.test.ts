import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as chaosRoute } from "../../src/app/api/v1/chaos/route";
import { createDatabaseConnection } from "../../src/lib/db";
import { migrate } from "../../db/migrate";
import { getSystemState } from "../../src/lib/system-state";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(process.cwd(), "data", "test_cross_process_chaos.db");

describe("Cross-Process Chaos and Endpoint Control (S13, S19)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  const ep1 = "https://mock-ep-1.devnet.solana.com";
  const ep2 = "https://mock-ep-2.devnet.solana.com";
  const oldEnv = { ...process.env };

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {}
    }
    process.env.DB_PATH = TEST_DB_PATH;
    process.env.ADMIN_API_KEY = "test_admin_secret_key";
    process.env.CHAOS_ENABLED = "true";
    process.env.NODE_ENV = "test";
    process.env.CLUSTER = "devnet";
    process.env.RPC_ENDPOINTS = "https://api.devnet.solana.com,https://devnet.helius-rpc.com";

    db = createDatabaseConnection(TEST_DB_PATH);
    migrate(db);
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {}
    }
    for (const k of Object.keys(process.env)) {
      if (!(k in oldEnv)) {
        delete process.env[k];
      } else {
        process.env[k] = oldEnv[k];
      }
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {}
    }
  });

  it("S13: returns 404 when CHAOS_ENABLED is false", async () => {
    process.env.CHAOS_ENABLED = "false";

    const req = new NextRequest("http://localhost:3000/api/v1/chaos", {
      method: "POST",
      headers: {
        authorization: "Bearer test_admin_secret_key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ endpoint: ep1, mode: "down" }),
    });

    const res = await chaosRoute(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("not_found");
  });

  it("returns 401 when authorization header is missing or invalid", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/chaos", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong_admin_key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ endpoint: ep1, mode: "down" }),
    });

    const res = await chaosRoute(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 on malformed payload or unknown chaos mode", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/chaos", {
      method: "POST",
      headers: {
        authorization: "Bearer test_admin_secret_key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ endpoint: ep1, mode: "invalid_mode" }),
    });

    const res = await chaosRoute(req);
    expect(res.status).toBe(400);
  });

  it("S19: chaos flag written via API route in app process alters router endpoint selection in a separately spawned child worker process", async () => {
    // 1. App process sets ep1 to 'down' via POST /api/v1/chaos
    const req = new NextRequest("http://localhost:3000/api/v1/chaos", {
      method: "POST",
      headers: {
        authorization: "Bearer test_admin_secret_key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ endpoint: ep1, mode: "down" }),
    });

    const res = await chaosRoute(req);
    expect(res.status).toBe(200);
    const resJson = await res.json();
    expect(resJson.ok).toBe(true);
    expect(resJson.endpoint).toBe(ep1);
    expect(resJson.mode).toBe("down");

    // Verify written to SQLite system_state
    const storedState = getSystemState(db, `chaos:${ep1}`);
    expect(storedState?.value).toEqual({ mode: "down" });

    // 2. Spawn an isolated child worker process running tests/fixtures/worker-child.ts
    // with DB_PATH pointing to the same SQLite database
    const scriptPath = path.resolve(process.cwd(), "tests/fixtures/worker-child.ts");
    const child = spawnSync("npx", ["tsx", scriptPath], {
      shell: true,
      env: {
        ...process.env,
        DB_PATH: TEST_DB_PATH,
        TEST_EP1: ep1,
        TEST_EP2: ep2,
        CHAOS_ENABLED: "true",
        CLUSTER: "devnet",
        RPC_ENDPOINTS: "https://api.devnet.solana.com,https://devnet.helius-rpc.com",
        ADMIN_API_KEY: "test_admin_secret_key",
        NODE_ENV: "test",
      },
      encoding: "utf8",
    });

    if (child.error) {
      throw child.error;
    }

    if (child.status !== 0) {
      console.error("Child process stderr:", child.stderr);
      console.error("Child process stdout:", child.stdout);
      throw new Error(`Child worker process exited with code ${child.status}`);
    }

    // Find the WORKER_RESULT line from the child process
    const lines = child.stdout.trim().split("\n");
    const resultLine = lines.find((l) => l.trim().startsWith("WORKER_RESULT:"));
    expect(resultLine).toBeDefined();

    const output = JSON.parse(resultLine!.trim().replace("WORKER_RESULT:", ""));
    // The child worker router must have bypassed ep1 (because of the chaos flag written by the app)
    // and successfully routed to ep2
    expect(output.result).toBe(`${ep2}_selected`);
    expect(output.selectedEndpoints).toEqual([ep2]);
  });
});
