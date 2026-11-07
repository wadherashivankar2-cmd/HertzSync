/**
 * Canonical JSON serialization for usage events.
 * Key order must be strictly fixed:
 * ["amountLamports", "businessId", "deviceId", "epoch", "occurredAt", "seq"]
 * Whitespace must be strictly omitted.
 * Section 5.1 step 5
 */

export interface CanonicalEventPayload {
  amountLamports: number;
  businessId: string;
  deviceId: string;
  epoch: number;
  occurredAt: number;
  seq: number;
}

export function canonicalizeEventPayload(payload: CanonicalEventPayload): string {
  // Enforce explicit fixed key order and JSON encoding without whitespace
  return JSON.stringify({
    amountLamports: payload.amountLamports,
    businessId: payload.businessId,
    deviceId: payload.deviceId,
    epoch: payload.epoch,
    occurredAt: payload.occurredAt,
    seq: payload.seq,
  });
}

