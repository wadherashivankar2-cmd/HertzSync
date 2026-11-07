import { describe, it, expect } from "vitest";
import { getStatusMeta, STATUS_MAP, InternalState } from "../../src/lib/status-labels";

describe("Status Labels & Tooltips (Blueprint Section 9.3 & Phase 6)", () => {
  const blueprintStates: Array<{
    state: InternalState;
    expectedLabel: string;
    expectedColor: string;
    expectedTooltip: string;
  }> = [
    {
      state: "queued",
      expectedLabel: "Waiting to be paid",
      expectedColor: "pending",
      expectedTooltip: "Recorded safely. Will be paid when the network is available.",
    },
    {
      state: "batched",
      expectedLabel: "Being paid",
      expectedColor: "pending",
      expectedTooltip: "Grouped into a payment that is on its way.",
    },
    {
      state: "paid",
      expectedLabel: "Paid on Solana",
      expectedColor: "accent",
      expectedTooltip: "Confirmed on the Solana test network.",
    },
    {
      state: "flagged",
      expectedLabel: "Needs review",
      expectedColor: "failed",
      expectedTooltip: "Could not be paid automatically. A person should check it.",
    },
    {
      state: "retrying",
      expectedLabel: "Retrying",
      expectedColor: "pending",
      expectedTooltip: "The network did not confirm yet. Trying again safely.",
    },
    {
      state: "conflict",
      expectedLabel: "Conflicting record",
      expectedColor: "failed",
      expectedTooltip: "A different record with the same ID arrived. The original was kept.",
    },
  ];

  it("maps every Blueprint Section 9.3 state to exact label, color token, and plain-language tooltip", () => {
    for (const item of blueprintStates) {
      const meta = getStatusMeta(item.state);
      expect(meta.label).toBe(item.expectedLabel);
      expect(meta.color).toBe(item.expectedColor);
      expect(meta.tooltip).toBe(item.expectedTooltip);
    }
  });

  it("handles batch settlement lifecycle states gracefully", () => {
    expect(getStatusMeta("built").label).toBe("Being paid");
    expect(getStatusMeta("submitted").label).toBe("Submitted to network");
    expect(getStatusMeta("confirmed").label).toBe("Paid on Solana");
    expect(getStatusMeta("expired_rebuilt").label).toBe("Rebuilt after timeout");
    expect(getStatusMeta("failed_review").label).toBe("Needs review");
  });

  it("provides fallback for unknown state", () => {
    const fallback = getStatusMeta("some_unknown_state");
    expect(fallback.label).toBe("some_unknown_state");
    expect(fallback.color).toBe("info");
    expect(fallback.tooltip).toBe("Status: some_unknown_state");
  });
});

