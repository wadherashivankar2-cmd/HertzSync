import { describe, it, expect } from "vitest";
import {
  handleShutdownSignal,
  isShuttingDown,
  trackInFlightRequest,
} from "../../src/lib/lifecycle";

describe("App Shutdown Lifecycle (S20 app side)", () => {
  it("allows in-flight requests to complete before closing", async () => {
    const endInFlight = trackInFlightRequest();

    let exitCode: number | null = null;
    const mockExit = (code: number) => {
      exitCode = code;
    };

    // Trigger SIGINT
    handleShutdownSignal("SIGINT", mockExit);
    expect(isShuttingDown()).toBe(true);

    // Should not exit immediately while in-flight request exists
    await new Promise((r) => setTimeout(r, 150));
    expect(exitCode).toBeNull();

    // In-flight request finishes
    endInFlight();

    // Check interval picks up 0 in-flight requests and exits 0
    await new Promise((r) => setTimeout(r, 350));
    expect(exitCode).toBe(0);
  });
});
