import { describe, expect, it } from "@jest/globals";
import {
  hasTerminalEventSince,
  normalizeSelectedSkills,
  shouldClearWaitingForTerminalState,
} from "./use-conversation";
import type { AgentEvent } from "@/shared/types";

describe("shouldClearWaitingForTerminalState", () => {
  it("returns false when the UI is not waiting for the agent", () => {
    expect(shouldClearWaitingForTerminalState(false, "error")).toBe(false);
  });

  it("clears waiting when the turn reaches an error state", () => {
    expect(shouldClearWaitingForTerminalState(true, "error")).toBe(true);
  });

  it("clears waiting when the turn completes successfully", () => {
    expect(shouldClearWaitingForTerminalState(true, "complete")).toBe(true);
  });

  it("keeps waiting during active planning or execution", () => {
    expect(shouldClearWaitingForTerminalState(true, "planning")).toBe(false);
    expect(shouldClearWaitingForTerminalState(true, "executing")).toBe(false);
    expect(shouldClearWaitingForTerminalState(true, "idle")).toBe(false);
  });
});

describe("hasTerminalEventSince", () => {
  it("detects batched terminal events after the send snapshot", () => {
    const events: AgentEvent[] = [
      { type: "turn_start", data: { message: "hi" }, timestamp: 1, iteration: null },
      { type: "task_complete", data: { summary: "done" }, timestamp: 2, iteration: 1 },
      { type: "turn_complete", data: { result: "done" }, timestamp: 3, iteration: 1 },
    ];

    expect(hasTerminalEventSince(events, 1)).toBe(true);
  });

  it("ignores non-terminal events after the send snapshot", () => {
    const events: AgentEvent[] = [
      { type: "turn_start", data: { message: "hi" }, timestamp: 1, iteration: null },
      { type: "thinking", data: { thinking: "working" }, timestamp: 2, iteration: 1 },
      { type: "text_delta", data: { delta: "partial" }, timestamp: 3, iteration: 1 },
    ];

    expect(hasTerminalEventSince(events, 1)).toBe(false);
  });
});

describe("normalizeSelectedSkills", () => {
  it("keeps selected skills in order and drops blanks/duplicates", () => {
    expect(
      normalizeSelectedSkills([" frontend-design ", "", "frontend-design", "pdf"], 123),
    ).toEqual([
      { name: "frontend-design", timestamp: 123 },
      { name: "pdf", timestamp: 123 },
    ]);
  });
});
