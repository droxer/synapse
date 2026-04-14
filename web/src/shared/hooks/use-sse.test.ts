import { describe, expect, it } from "@jest/globals";
import {
  parseSSEEvent,
  shouldFlushEventImmediately,
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

  it("coerces numeric tool_id on tool_call and tool_result for stable correlation", () => {
    const call = parseSSEEvent(
      JSON.stringify({
        event_type: "tool_call",
        data: {
          tool_name: "activate_skill",
          tool_input: { name: "docx" },
          tool_id: 9001,
        },
        timestamp: 1,
        iteration: 0,
      }),
      "tool_call",
    );
    expect(call?.data.tool_id).toBe("9001");

    const res = parseSSEEvent(
      JSON.stringify({
        event_type: "tool_result",
        data: { tool_id: 9001, success: true, output: "ok" },
        timestamp: 2,
        iteration: 0,
      }),
      "tool_result",
    );
    expect(res?.data.tool_id).toBe("9001");
  });
});

describe("shouldFlushEventImmediately", () => {
  it("flushes terminal and interaction-critical events immediately", () => {
    expect(shouldFlushEventImmediately("turn_complete")).toBe(true);
    expect(shouldFlushEventImmediately("ask_user")).toBe(true);
  });

  it("does not flush token-level model updates immediately", () => {
    expect(shouldFlushEventImmediately("text_delta")).toBe(false);
    expect(shouldFlushEventImmediately("llm_response")).toBe(false);
  });
});
