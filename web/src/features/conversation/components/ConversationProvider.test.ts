import { describe, expect, it } from "@jest/globals";
import {
  getHistoryRefetchModeForTerminalEvent,
  shouldRefetchHistoryForTerminalEvent,
} from "./ConversationProvider";
import { shouldConnectConversationEvents } from "./conversation-event-connection";

describe("shouldConnectConversationEvents", () => {
  it("does not connect without a conversation id", () => {
    expect(shouldConnectConversationEvents(null, true, false, null)).toBe(false);
  });

  it("does not connect for non-live conversations", () => {
    expect(shouldConnectConversationEvents("c1", false, false, null)).toBe(false);
  });

  it("allows immediate SSE for a newly created pending route", () => {
    expect(shouldConnectConversationEvents("c1", true, true, "c1")).toBe(true);
  });

  it("waits for history validation on restored live conversations", () => {
    expect(shouldConnectConversationEvents("c1", true, true, null)).toBe(false);
    expect(shouldConnectConversationEvents("c1", true, false, null)).toBe(true);
  });
});

describe("shouldRefetchHistoryForTerminalEvent", () => {
  it("refetches history for terminal transcript events", () => {
    expect(shouldRefetchHistoryForTerminalEvent({
      type: "turn_complete",
      data: { result: "done" },
      timestamp: 1,
      iteration: 1,
    })).toBe(true);
    expect(shouldRefetchHistoryForTerminalEvent({
      type: "turn_cancelled",
      data: {},
      timestamp: 1,
      iteration: 1,
    })).toBe(true);
    expect(shouldRefetchHistoryForTerminalEvent({
      type: "task_error",
      data: { error: "boom" },
      timestamp: 1,
      iteration: 1,
    })).toBe(true);
  });

  it("also refetches when a turn ends on task_complete alone", () => {
    expect(shouldRefetchHistoryForTerminalEvent({
      type: "task_complete",
      data: { summary: "done" },
      timestamp: 1,
      iteration: 1,
    })).toBe(true);
  });
});

describe("getHistoryRefetchModeForTerminalEvent", () => {
  it("uses transcript-only refetches for canonical persisted transcript rows", () => {
    expect(getHistoryRefetchModeForTerminalEvent({
      type: "turn_complete",
      data: { result: "done" },
      timestamp: 1,
      iteration: 1,
    })).toBe("transcript");
    expect(getHistoryRefetchModeForTerminalEvent({
      type: "turn_cancelled",
      data: {},
      timestamp: 1,
      iteration: 1,
    })).toBe("transcript");
    expect(getHistoryRefetchModeForTerminalEvent({
      type: "task_error",
      data: { error: "boom" },
      timestamp: 1,
      iteration: 1,
    })).toBe("transcript");
  });

  it("uses full history refetches when task_complete is the only terminal transcript source", () => {
    expect(getHistoryRefetchModeForTerminalEvent({
      type: "task_complete",
      data: { summary: "done" },
      timestamp: 1,
      iteration: 1,
    })).toBe("all");
  });
});
