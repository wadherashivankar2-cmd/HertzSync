import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { authenticateBusiness } from "@/lib/auth";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";
import { canonicalizeEventPayload } from "@/lib/canonical";
import { computePayloadHash, verifyEd25519Signature } from "@/lib/crypto";
import { incrementCounter } from "@/lib/counters";
import { writeAuditLog } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { isShuttingDown, trackInFlightRequest } from "@/lib/lifecycle";

const eventBodySchema = z.object({
  deviceId: z.string().min(1, "deviceId is required"),
  epoch: z.number().int().positive("epoch must be a positive integer"),
  seq: z.number().int().positive("seq must be a positive integer"),
  amountLamports: z.number().int().positive("amountLamports must be a positive integer"),
  occurredAt: z.number().int().positive("occurredAt must be a valid unix timestamp in ms"),
  signature: z.string().min(1, "signature is required"),
});

export async function POST(req: NextRequest) {
  if (isShuttingDown()) {
    return NextResponse.json(
      { error: { code: "service_unavailable", message: "Server is shutting down." } },
      { status: 503 }
    );
  }

  const endRequest = trackInFlightRequest();
  const db = getDb();
  const config = getConfig();

  try {
    // 1. Authenticate API key
    const authHeader = req.headers.get("authorization");
    const business = authenticateBusiness(db, authHeader);
    if (!business) {
      writeAuditLog(db, "api", "auth_failed", { reason: "invalid_or_missing_api_key" });
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Invalid or missing API key." } },
        { status: 401 }
      );
    }

    // 2. Rate limit check
    const rateLimitKey = deriveRateLimitKey(business.apiKeyHash);
    const rl = checkRateLimit(db, rateLimitKey);
    if (!rl.allowed) {
      writeAuditLog(db, "api", "rate_limit_exceeded", {
        businessId: business.id,
        count: rl.count,
        limit: rl.limit,
      });
      return NextResponse.json(
        { error: { code: "rate_limited", message: "Too many requests. Please wait." } },
        {
          status: 429,
          headers: { "Retry-After": rl.retryAfterSeconds.toString() },
        }
      );
    }

    // 3. Parse JSON body with zod schema
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: "invalid_json", message: "Invalid JSON in request body." } },
        { status: 400 }
      );
    }

    const parseResult = eventBodySchema.safeParse(body);
    if (!parseResult.success) {
      const issues = parseResult.error.issues || [];
      return NextResponse.json(
        {
          error: {
            code: "validation_error",
            message: issues.map((e) => e.message).join(", "),
          },
        },
        { status: 400 }
      );
    }

    const { deviceId, epoch, seq, amountLamports, occurredAt, signature } = parseResult.data;

    if (amountLamports > config.MAX_EVENT_LAMPORTS) {
      return NextResponse.json(
        {
          error: {
            code: "amount_exceeded",
            message: `Event amount exceeds maximum allowed: ${config.MAX_EVENT_LAMPORTS}`,
          },
        },
        { status: 400 }
      );
    }

    // 4. Verify device ownership and status
    const device = db
      .prepare("SELECT business_id, payee_id, public_key, status FROM devices WHERE id = ?")
      .get(deviceId) as
      | { business_id: string; payee_id: string; public_key: string; status: string }
      | undefined;

    if (!device || device.business_id !== business.id || device.status !== "active") {
      writeAuditLog(db, "api", "device_forbidden", {
        businessId: business.id,
        deviceId,
        reason: !device
          ? "device_not_found"
          : device.business_id !== business.id
          ? "device_ownership_mismatch"
          : "device_revoked",
      });
      incrementCounter(db, "events_rejected_total");
      return NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: "Device not found, not active, or does not belong to business.",
          },
        },
        { status: 403 }
      );
    }

    // 5. Build canonical payload
    const canonicalPayload = {
      amountLamports,
      businessId: business.id,
      deviceId,
      epoch,
      occurredAt,
      seq,
    };
    const canonicalJson = canonicalizeEventPayload(canonicalPayload);

    // 6. Verify Ed25519 signature
    const isValidSignature = verifyEd25519Signature(canonicalJson, signature, device.public_key);
    if (!isValidSignature) {
      writeAuditLog(db, "api", "signature_rejected", {
        businessId: business.id,
        deviceId,
        epoch,
        seq,
      });
      incrementCounter(db, "events_rejected_total");
      return NextResponse.json(
        { error: { code: "invalid_signature", message: "Device signature verification failed." } },
        { status: 401 }
      );
    }

    // 7. Compute payload hash and event ID
    const payloadHash = computePayloadHash(canonicalPayload);
    const eventId = `${deviceId}:${epoch}:${seq}`;
    const receivedAt = Date.now();

    // 8. In one SQLite transaction: insert or handle duplicate/conflict
    const result = db.transaction(() => {
      // Check if new epoch registration for active device
      const existingEpoch = db
        .prepare("SELECT 1 FROM events WHERE device_id = ? AND epoch = ? LIMIT 1")
        .get(deviceId, epoch);

      if (!existingEpoch) {
        writeAuditLog(db, "api", "new_epoch_registered", {
          businessId: business.id,
          deviceId,
          epoch,
        });
      }

      // Check for existing event with same (device_id, epoch, seq)
      const existing = db
        .prepare(
          "SELECT id, payload_hash, state, batch_id FROM events WHERE device_id = ? AND epoch = ? AND seq = ?"
        )
        .get(deviceId, epoch, seq) as
        | { id: string; payload_hash: string; state: string; batch_id: string | null }
        | undefined;

      if (existing) {
        if (existing.payload_hash === payloadHash) {
          // Retransmission / duplicate
          incrementCounter(db, "events_duplicate_total");
          return {
            status: 200,
            body: {
              id: existing.id,
              state: existing.state,
              duplicate: true,
              batchId: existing.batch_id,
            },
          };
        } else {
          // Conflict: same key, different content! Reject loudly.
          incrementCounter(db, "events_conflict_total");
          writeAuditLog(db, "api", "event_conflict", {
            businessId: business.id,
            deviceId,
            epoch,
            seq,
            storedHash: existing.payload_hash,
            incomingHash: payloadHash,
          });
          return {
            status: 409,
            body: {
              error: {
                code: "event_conflict",
                message:
                  "An event with identical device, epoch, and sequence but different content already exists.",
              },
            },
          };
        }
      }

      // New event insertion
      db.prepare(`
        INSERT INTO events (
          id, business_id, device_id, epoch, seq, amount_lamports,
          occurred_at, received_at, payload_hash, signature, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
      `).run(
        eventId,
        business.id,
        deviceId,
        epoch,
        seq,
        amountLamports,
        occurredAt,
        receivedAt,
        payloadHash,
        signature
      );

      incrementCounter(db, "events_received_total");
      incrementCounter(db, "generated_by_ingest");

      // Record latency sample for ingest
      const durationMs = Math.max(0, Date.now() - receivedAt);
      db.prepare(`
        INSERT INTO latency_samples (at, kind, ms)
        VALUES (?, 'ingest', ?)
      `).run(receivedAt, durationMs);

      return {
        status: 202,
        body: {
          id: eventId,
          state: "queued",
        },
      };
    })();

    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "internal_error", message: "An unexpected error occurred." } },
      { status: 500 }
    );
  } finally {
    endRequest();
  }
}
