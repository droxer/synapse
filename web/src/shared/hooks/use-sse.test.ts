import { describe, expect, it } from "@jest/globals";
import { shouldScheduleReconnect } from "./use-sse";

describe("shouldScheduleReconnect", () => {
  it("returns false when stopped", () => {
    expect(
      shouldScheduleReconnect({
        isStopped: true,
        retryCount: 0,
        maxRetries: 3,
        hasPendingTimer: false,
      }),
    ).toBe(false);
  });

  it("returns false when max retries reached", () => {
    expect(
      shouldScheduleReconnect({
        isStopped: false,
        retryCount: 3,
        maxRetries: 3,
        hasPendingTimer: false,
      }),
    ).toBe(false);
  });

  it("returns false when a timer is already pending", () => {
    expect(
      shouldScheduleReconnect({
        isStopped: false,
        retryCount: 1,
        maxRetries: 3,
        hasPendingTimer: true,
      }),
    ).toBe(false);
  });

  it("returns true when retry is allowed", () => {
    expect(
      shouldScheduleReconnect({
        isStopped: false,
        retryCount: 1,
        maxRetries: 3,
        hasPendingTimer: false,
      }),
    ).toBe(true);
  });
});
