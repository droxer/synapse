import { describe, expect, it } from "@jest/globals";
import { shouldAutoScrollToBottom } from "./conversation-scroll";
import { getLatestTurnMode } from "./conversation-mode";
import type { AgentEvent } from "@/shared/types";

describe("shouldAutoScrollToBottom", () => {
  it("scrolls on first populate", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 0,
        nextActivityCount: 1,
        distanceFromBottom: 999,
      }),
    ).toBe(true);
  });

  it("does not scroll when there is no new activity", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 5,
        nextActivityCount: 5,
        distanceFromBottom: 10,
      }),
    ).toBe(false);
  });

  it("scrolls when new activity arrives near bottom", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 5,
        nextActivityCount: 6,
        distanceFromBottom: 60,
      }),
    ).toBe(true);
  });

  it("does not scroll when user is far from bottom", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 5,
        nextActivityCount: 6,
        distanceFromBottom: 300,
      }),
    ).toBe(false);
  });
});

describe("getLatestTurnMode", () => {
  it("returns planner when latest turn_start is planner", () => {
    const events: AgentEvent[] = [
      { type: "turn_start", data: { message: "one", orchestrator_mode: "agent" }, timestamp: 1, iteration: null },
      { type: "turn_start", data: { message: "two", orchestrator_mode: "planner" }, timestamp: 2, iteration: null },
    ];
    expect(getLatestTurnMode(events)).toBe("planner");
  });

  it("returns null when latest turn_start has no mode", () => {
    const events: AgentEvent[] = [
      { type: "turn_start", data: { message: "one", orchestrator_mode: "planner" }, timestamp: 1, iteration: null },
      { type: "turn_start", data: { message: "two" }, timestamp: 2, iteration: null },
    ];
    expect(getLatestTurnMode(events)).toBeNull();
  });
});
