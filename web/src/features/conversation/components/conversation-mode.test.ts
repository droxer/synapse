import { describe, expect, it } from "@jest/globals";
import {
  getCurrentTurnEventSlice,
  hasPlannerSignalsSinceLastTurnComplete,
  shouldShowPlannerModeBadge,
} from "./conversation-mode";
import type { AgentEvent } from "@/shared/types";

describe("getCurrentTurnEventSlice", () => {
  it("returns events after the last turn_complete", () => {
    const events: AgentEvent[] = [
      { type: "plan_created", data: {}, timestamp: 1, iteration: null },
      { type: "turn_complete", data: {}, timestamp: 2, iteration: null },
      { type: "tool_call", data: {}, timestamp: 3, iteration: null },
    ];
    expect(getCurrentTurnEventSlice(events).map((e: AgentEvent) => e.type)).toEqual(["tool_call"]);
  });
});

describe("hasPlannerSignalsSinceLastTurnComplete", () => {
  it("is true when plan_created is in the current turn slice", () => {
    const events: AgentEvent[] = [
      { type: "turn_complete", data: {}, timestamp: 1, iteration: null },
      { type: "plan_created", data: { steps: [] }, timestamp: 2, iteration: null },
    ];
    expect(hasPlannerSignalsSinceLastTurnComplete(events)).toBe(true);
  });

  it("is false when plan_created only exists before the last turn_complete", () => {
    const events: AgentEvent[] = [
      { type: "plan_created", data: { steps: [] }, timestamp: 1, iteration: null },
      { type: "turn_complete", data: {}, timestamp: 2, iteration: null },
      { type: "tool_call", data: {}, timestamp: 3, iteration: null },
    ];
    expect(hasPlannerSignalsSinceLastTurnComplete(events)).toBe(false);
  });
});

describe("shouldShowPlannerModeBadge", () => {
  const live = {
    plannerBadgeLive: true,
    explicitPlannerPending: false,
  };

  it("shows when taskState is planning", () => {
    expect(
      shouldShowPlannerModeBadge([], {
        taskState: "planning",
        isWaitingForAgent: false,
        ...live,
      }),
    ).toBe(true);
  });

  it("shows during executing when plan_created is in the current turn", () => {
    const events: AgentEvent[] = [
      { type: "turn_complete", data: {}, timestamp: 1, iteration: null },
      { type: "plan_created", data: { steps: [] }, timestamp: 2, iteration: null },
    ];
    expect(
      shouldShowPlannerModeBadge(events, {
        taskState: "executing",
        isWaitingForAgent: false,
        ...live,
      }),
    ).toBe(true);
  });

  it("does not use in-flight heuristics when plannerBadgeLive is false", () => {
    const events: AgentEvent[] = [
      { type: "plan_created", data: { steps: [] }, timestamp: 1, iteration: null },
    ];
    expect(
      shouldShowPlannerModeBadge(events, {
        taskState: "executing",
        isWaitingForAgent: true,
        explicitPlannerPending: false,
        plannerBadgeLive: false,
      }),
    ).toBe(false);
  });
});
