import { describe, it, expect } from "vitest";
import { canonicalizeEventPayload } from "../../src/lib/canonical";

describe("Canonical JSON Serialization", () => {
  it("serializes payload with exact key order and no whitespace", () => {
    const payload = {
      amountLamports: 50000,
      businessId: "biz_001",
      deviceId: "dev_001",
      epoch: 1700000000,
      occurredAt: 1700000000123,
      seq: 42,
    };

    const result = canonicalizeEventPayload(payload);
    const expected =
      '{"amountLamports":50000,"businessId":"biz_001","deviceId":"dev_001","epoch":1700000000,"occurredAt":1700000000123,"seq":42}';

    expect(result).toBe(expected);
  });

  it("is independent of input object property order", () => {
    // Provide fields in reverse or scrambled order
    const scrambled = {
      seq: 42,
      occurredAt: 1700000000123,
      epoch: 1700000000,
      deviceId: "dev_001",
      businessId: "biz_001",
      amountLamports: 50000,
    };

    const result = canonicalizeEventPayload(scrambled);
    const expected =
      '{"amountLamports":50000,"businessId":"biz_001","deviceId":"dev_001","epoch":1700000000,"occurredAt":1700000000123,"seq":42}';

    expect(result).toBe(expected);
  });
});

