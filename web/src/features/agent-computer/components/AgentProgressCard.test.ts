import { describe, expect, it } from "@jest/globals";
import { buildToolCallIndexes, isTimelineStepActionable } from "./AgentProgressCard";
import type { ToolCallInfo } from "../../../shared/types";

describe("buildToolCallIndexes", () => {
  it("groups calls by toolUseId and counts calls per agent", () => {
    const calls: ToolCallInfo[] = [
      {
        id: "tc-1",
        toolUseId: "same-id",
        name: "web_search",
        input: {},
        timestamp: 1,
        agentId: "agent-1",
      },
      {
        id: "tc-2",
        toolUseId: "same-id",
        name: "web_search",
        input: {},
        timestamp: 2,
        agentId: "agent-1",
      },
      {
        id: "tc-3",
        toolUseId: "other-id",
        name: "web_search",
        input: {},
        timestamp: 3,
        agentId: "agent-2",
      },
    ];

    const indexes = buildToolCallIndexes(calls);
    expect(indexes.byToolUseId.get("same-id")).toHaveLength(2);
    expect(indexes.countByAgentId.get("agent-1")).toBe(2);
    expect(indexes.countByAgentId.get("agent-2")).toBe(1);
  });
});

describe("isTimelineStepActionable", () => {
  it("flags tool and agent steps as actionable", () => {
    expect(isTimelineStepActionable("tool-tc-1")).toBe(true);
    expect(isTimelineStepActionable("agent-a1-123")).toBe(true);
    expect(isTimelineStepActionable("start-123")).toBe(false);
    expect(isTimelineStepActionable("complete-123")).toBe(false);
  });
});
