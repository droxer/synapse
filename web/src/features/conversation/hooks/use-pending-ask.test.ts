import { describe, expect, it } from "@jest/globals";
import type { AgentEvent } from "@/shared/types";
import { derivePendingAskFromEvents } from "./use-pending-ask";

describe("derivePendingAskFromEvents", () => {
  it("returns the latest unresolved ask_user request", () => {
    const events: AgentEvent[] = [
      {
        type: "ask_user",
        data: { request_id: "req-1", message: "First question?" },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "ask_user",
        data: { request_id: "req-2", message: "Second question?" },
        timestamp: 2,
        iteration: 1,
      },
    ];

    const pending = derivePendingAskFromEvents(events);
    expect(pending?.requestId).toBe("req-2");
    expect(pending?.question).toBe("Second question?");
  });

  it("skips asks that have matching user_response events", () => {
    const events: AgentEvent[] = [
      {
        type: "ask_user",
        data: { request_id: "req-1", message: "First question?" },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "ask_user",
        data: { request_id: "req-2", message: "Second question?" },
        timestamp: 2,
        iteration: 1,
      },
      {
        type: "user_response",
        data: { request_id: "req-2", response: "done" },
        timestamp: 3,
        iteration: 1,
      },
    ];

    const pending = derivePendingAskFromEvents(events);
    expect(pending?.requestId).toBe("req-1");
    expect(pending?.question).toBe("First question?");
  });
});
