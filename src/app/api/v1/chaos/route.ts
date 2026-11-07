import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { getDb } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { setSystemState } from "@/lib/system-state";
import { logger } from "@/lib/logger";

const chaosBodySchema = z.object({
  endpoint: z.string().min(1, "endpoint is required"),
  mode: z.enum(["off", "down", "timeout", "429", "lie"], {
    message: "mode must be one of 'off', 'down', 'timeout', '429', 'lie'",
  }),
});

function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  const config = getConfig();

  // Guard S13: Only active when CHAOS_ENABLED=true and NODE_ENV !== "production". Otherwise 404.
  const chaosEnabled =
    process.env.CHAOS_ENABLED !== undefined
      ? process.env.CHAOS_ENABLED === "true"
      : config.CHAOS_ENABLED;
  const isProduction =
    (process.env.NODE_ENV !== undefined ? process.env.NODE_ENV : config.NODE_ENV) === "production";

  if (!chaosEnabled || isProduction) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Chaos route is disabled." } },
      { status: 404 }
    );
  }

  // Admin authentication check
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing or invalid authorization header." } },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7).trim();
  const adminKey = process.env.ADMIN_API_KEY || config.ADMIN_API_KEY;
  if (!timingSafeMatch(token, adminKey)) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Invalid admin API key." } },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Malformed JSON payload." } },
      { status: 400 }
    );
  }

  const parseResult = chaosBodySchema.safeParse(body);
  if (!parseResult.success) {
    const errorObj: any = parseResult.error;
    const issues: any[] = errorObj?.issues || errorObj?.errors || [];
    return NextResponse.json(
      {
        error: {
          code: "bad_request",
          message: issues.map((e: any) => e.message).join(", "),
        },
      },
      { status: 400 }
    );
  }

  const { endpoint, mode } = parseResult.data;
  const db = getDb();

  setSystemState(db, `chaos:${endpoint}`, { mode });
  logger.info(`Chaos mode updated for endpoint ${endpoint} -> ${mode}`);

  return NextResponse.json({
    ok: true,
    endpoint,
    mode,
  });
}
