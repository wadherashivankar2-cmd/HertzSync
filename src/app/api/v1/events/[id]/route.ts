import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateBusiness } from "@/lib/auth";
import { isShuttingDown, trackInFlightRequest } from "@/lib/lifecycle";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (isShuttingDown()) {
    return NextResponse.json(
      { error: { code: "service_unavailable", message: "Server is shutting down." } },
      { status: 503 }
    );
  }

  const endRequest = trackInFlightRequest();
  const db = getDb();

  try {
    const authHeader = req.headers.get("authorization");
    const business = authenticateBusiness(db, authHeader);
    if (!business) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Invalid or missing API key." } },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const row = db
      .prepare(`
        SELECT id, business_id, device_id, epoch, seq, amount_lamports,
               occurred_at, received_at, payload_hash, state, batch_id
        FROM events
        WHERE id = ?
      `)
      .get(id) as
      | {
          id: string;
          business_id: string;
          device_id: string;
          epoch: number;
          seq: number;
          amount_lamports: number;
          occurred_at: number;
          received_at: number;
          payload_hash: string;
          state: string;
          batch_id: string | null;
        }
      | undefined;

    if (!row) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Event not found." } },
        { status: 404 }
      );
    }

    // Guard: Business can only query its own events
    if (row.business_id !== business.id) {
      return NextResponse.json(
        { error: { code: "forbidden", message: "Forbidden." } },
        { status: 403 }
      );
    }

    // Never return the full signature to other businesses (Section 7.1 & Phase 2 item 5)
    return NextResponse.json(
      {
        id: row.id,
        deviceId: row.device_id,
        epoch: row.epoch,
        seq: row.seq,
        amountLamports: row.amount_lamports,
        occurredAt: row.occurred_at,
        receivedAt: row.received_at,
        payloadHash: row.payload_hash,
        state: row.state,
        batchId: row.batch_id,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "internal_error", message: "An unexpected error occurred." } },
      { status: 500 }
    );
  } finally {
    endRequest();
  }
}

