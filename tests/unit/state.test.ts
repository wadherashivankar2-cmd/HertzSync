import { describe, it, expect } from "vitest";
import {
  transitionEvent,
  transitionBatch,
  EventState,
  BatchState,
} from "../../src/lib/state";

describe("State Transitions", () => {
  describe("Event State Machine", () => {
    it("allows legal event transitions", () => {
      // queued -> batched -> paid
      expect(transitionEvent("queued", "batched")).toBe("batched");
      expect(transitionEvent("batched", "paid")).toBe("paid");

      // queued -> flagged
      expect(transitionEvent("queued", "flagged")).toBe("flagged");

      // batched -> flagged
      expect(transitionEvent("batched", "flagged")).toBe("flagged");
    });

    it("rejects all illegal event transitions", () => {
      const illegalTransitions: Array<[EventState, EventState]> = [
        ["paid", "queued"],
        ["paid", "batched"],
        ["paid", "flagged"],
        ["flagged", "queued"],
        ["flagged", "batched"],
        ["flagged", "paid"],
        ["queued", "paid"],
        ["batched", "queued"],
      ];

      for (const [from, to] of illegalTransitions) {
        expect(() => transitionEvent(from, to)).toThrow(/Illegal event state transition/);
      }
    });
  });

  describe("Batch State Machine", () => {
    it("allows legal batch transitions", () => {
      expect(transitionBatch("built", "submitted")).toBe("submitted");
      expect(transitionBatch("submitted", "confirmed")).toBe("confirmed");
      expect(transitionBatch("submitted", "retrying")).toBe("retrying");
      expect(transitionBatch("submitted", "failed_review")).toBe("failed_review");
      expect(transitionBatch("retrying", "submitted")).toBe("submitted");
      expect(transitionBatch("retrying", "expired_rebuilt")).toBe("expired_rebuilt");
      expect(transitionBatch("retrying", "failed_review")).toBe("failed_review");
      expect(transitionBatch("expired_rebuilt", "submitted")).toBe("submitted");
    });

    it("rejects all illegal batch transitions", () => {
      const illegalTransitions: Array<[BatchState, BatchState]> = [
        ["confirmed", "built"],
        ["confirmed", "submitted"],
        ["confirmed", "retrying"],
        ["failed_review", "built"],
        ["failed_review", "submitted"],
        ["built", "confirmed"],
        ["built", "retrying"],
        ["built", "failed_review"],
        ["submitted", "built"],
        ["retrying", "built"],
        ["retrying", "confirmed"],
        ["expired_rebuilt", "confirmed"],
      ];

      for (const [from, to] of illegalTransitions) {
        expect(() => transitionBatch(from, to)).toThrow(/Illegal batch state transition/);
      }
    });
  });
});

