import { describe, expect, it } from "@jest/globals";
import { normalizeSelectedSkills, shouldClearWaitingForTerminalState } from "./use-conversation";

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
