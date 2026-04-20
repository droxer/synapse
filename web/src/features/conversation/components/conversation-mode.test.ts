import { describe, expect, it } from "@jest/globals";
import {
  getPlanMessageIndex,
  getCurrentTurnEventSlice,
  getIsCurrentTurnAutoDetected,
  hasPlannerSignalsSinceLastTurnComplete,
  shouldShowPlannerModeBadge,
} from "./conversation-mode";
import type { AgentEvent, ChatMessage } from "@/shared/types";

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

describe("getPlanMessageIndex", () => {
  it("anchors the checklist to the assistant message in the latest planner turn", () => {
    const events: AgentEvent[] = [
      { type: "turn_start", data: { message: "first", orchestrator_mode: "planner" }, timestamp: 1, iteration: null },
      { type: "plan_created", data: { steps: [] }, timestamp: 2, iteration: null },
      { type: "turn_complete", data: {}, timestamp: 3, iteration: null },
      { type: "turn_start", data: { message: "second", orchestrator_mode: "planner" }, timestamp: 10, iteration: null },
      { type: "plan_created", data: { steps: [] }, timestamp: 11, iteration: null },
    ];
    const messages: ChatMessage[] = [
      { role: "user", content: "first", timestamp: 1 },
      { role: "assistant", content: "first result", timestamp: 2 },
      { role: "user", content: "second", timestamp: 10 },
      { role: "assistant", content: "second result", timestamp: 12 },
    ];

    expect(getPlanMessageIndex(events, messages)).toBe(3);
  });

  it("does not anchor a new planner turn to an assistant message from an older turn", () => {
    const events: AgentEvent[] = [
      { type: "turn_start", data: { message: "first", orchestrator_mode: "planner" }, timestamp: 1, iteration: null },
      { type: "plan_created", data: { steps: [] }, timestamp: 2, iteration: null },
      { type: "turn_complete", data: {}, timestamp: 3, iteration: null },
      { type: "turn_start", data: { message: "second", orchestrator_mode: "planner" }, timestamp: 10, iteration: null },
      { type: "plan_created", data: { steps: [] }, timestamp: 11, iteration: null },
    ];
    const messages: ChatMessage[] = [
      { role: "user", content: "first", timestamp: 1 },
      { role: "assistant", content: "first result", timestamp: 2 },
      { role: "user", content: "second", timestamp: 10 },
    ];

    expect(getPlanMessageIndex(events, messages)).toBeNull();
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

describe("getIsCurrentTurnAutoDetected", () => {
  it("matches planner_auto_selected immediately before the latest turn_start", () => {
    const events: AgentEvent[] = [
      { type: "planner_auto_selected", data: {}, timestamp: 1, iteration: null },
      { type: "turn_start", data: { message: "hello", orchestrator_mode: "planner" }, timestamp: 2, iteration: null },
    ];

    expect(getIsCurrentTurnAutoDetected(events)).toBe(true);
  });

  it("tolerates conversation_title between planner_auto_selected and turn_start", () => {
    const events: AgentEvent[] = [
      { type: "planner_auto_selected", data: {}, timestamp: 1, iteration: null },
      { type: "conversation_title", data: { title: "hello" }, timestamp: 2, iteration: null },
      { type: "turn_start", data: { message: "hello", orchestrator_mode: "planner" }, timestamp: 3, iteration: null },
    ];

    expect(getIsCurrentTurnAutoDetected(events)).toBe(true);
  });

  it("stays current-turn scoped and ignores older planner_auto_selected events", () => {
    const events: AgentEvent[] = [
      { type: "planner_auto_selected", data: {}, timestamp: 1, iteration: null },
      { type: "turn_start", data: { message: "first", orchestrator_mode: "planner" }, timestamp: 2, iteration: null },
      { type: "turn_complete", data: {}, timestamp: 3, iteration: null },
      { type: "tool_call", data: {}, timestamp: 4, iteration: null },
      { type: "turn_start", data: { message: "second", orchestrator_mode: "planner" }, timestamp: 5, iteration: null },
    ];

    expect(getIsCurrentTurnAutoDetected(events)).toBe(false);
  });
});
