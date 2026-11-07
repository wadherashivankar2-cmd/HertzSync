import { describe, it, expect } from "vitest";
import { generateUlid, buildBatchMemo, MEMO_MAX_BYTES } from "../../src/lib/ids";

describe("IDs and Memo Building", () => {
  it("generates 26-character time-sortable ULID", () => {
    const ulid1 = generateUlid(1000);
    const ulid2 = generateUlid(2000);

    expect(ulid1).toHaveLength(26);
    expect(ulid2).toHaveLength(26);
    expect(ulid1 < ulid2).toBe(true);
  });

  it("builds valid memo within MEMO_MAX_BYTES (120 bytes)", () => {
    const batchId = generateUlid();
    const eventsHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // 64 hex chars
    const memo = buildBatchMemo(batchId, eventsHash);

    expect(memo.startsWith("trickle:v1:")).toBe(true);
    expect(Buffer.byteLength(memo, "utf8")).toBeLessThanOrEqual(MEMO_MAX_BYTES);
  });

  it("throws when memo exceeds MEMO_MAX_BYTES", () => {
    const batchId = generateUlid();
    const oversizedHash = "A".repeat(110);
    expect(() => buildBatchMemo(batchId, oversizedHash)).toThrow(/exceeds maximum allowed bytes/);
  });
});

