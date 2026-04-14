import { describe, expect, it } from "@jest/globals";
import {
  clearPendingReconnectTimer,
  parseSSEEvent,
  shouldScheduleReconnect,
} from "./use-sse";

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

describe("parseSSEEvent", () => {
  it("accepts skill_setup_failed events", () => {
    const parsed = parseSSEEvent(
      JSON.stringify({
        event_type: "skill_setup_failed",
        data: {
          name: "docx",
          phase: "dependencies",
          error: "pip install failed",
          source: "auto",
        },
        timestamp: 123,
        iteration: 1,
      }),
      "skill_setup_failed",
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("skill_setup_failed");
    expect(parsed?.data.name).toBe("docx");
    expect(parsed?.data.phase).toBe("dependencies");
  });
});

describe("clearPendingReconnectTimer", () => {
  it("clears and nulls an active reconnect timer", () => {
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = {
      current: setTimeout(() => undefined, 1_000),
    };

    clearPendingReconnectTimer(timerRef);
    expect(timerRef.current).toBeNull();
  });

  it("keeps null timer refs unchanged", () => {
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = {
      current: null,
    };

    clearPendingReconnectTimer(timerRef);
    expect(timerRef.current).toBeNull();
  });
});
