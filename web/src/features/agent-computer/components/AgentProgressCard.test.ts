import { describe, expect, it } from "@jest/globals";
import { buildSteps, buildToolCallIndexes, isTimelineStepActionable } from "./AgentProgressCard";
import type { AgentEvent, ToolCallInfo } from "../../../shared/types";
import type { TFn } from "@/shared/types/i18n";

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

function createTestTranslator(): TFn {
  return ((key: string, params?: Record<string, string | number>) => {
    switch (key) {
      case "progress.searchingTarget":
        return `searching ${params?.target ?? ""}`;
      case "progress.loadingSkills":
        return `loading ${params?.name ?? ""} skills`;
      case "progress.parsingContent":
        return `parse ${params?.target ?? ""} content`;
      case "progress.runtimeUnknown":
        return "unknown";
      case "progress.usingTool":
        return `using ${params?.name ?? ""} tool`;
      default:
        return key;
    }
  }) as TFn;
}

describe("buildSteps runtime phrase mapping", () => {
  const t = createTestTranslator();
  const agentNameMap = new Map<string, string>();

  it("maps web search into searching phrase", () => {
    const events = [
      {
        type: "tool_call",
        timestamp: 1,
        iteration: 0,
        data: { name: "web_search", tool_id: "tool-1", input: { query: "AI coding harness" } },
      },
    ] as unknown as AgentEvent[];
    const toolCalls: ToolCallInfo[] = [
      { id: "tc-1", toolUseId: "tool-1", name: "web_search", input: { query: "AI coding harness" }, timestamp: 1, output: "ok" },
    ];

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), t, agentNameMap);
    expect(steps[0]?.title).toBe("searching AI coding harness");
  });

  it("maps skill activation into loading skills phrase", () => {
    const events = [
      {
        type: "tool_call",
        timestamp: 1,
        iteration: 0,
        data: { name: "activate_skill", tool_id: "tool-2", input: { name: "frontend-design" } },
      },
    ] as unknown as AgentEvent[];
    const toolCalls: ToolCallInfo[] = [
      { id: "tc-2", toolUseId: "tool-2", name: "activate_skill", input: { name: "frontend-design" }, timestamp: 1, output: "ok" },
    ];

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), t, agentNameMap);
    expect(steps[0]?.title).toContain("loading");
    expect(steps[0]?.title).toContain("skills");
  });

  it("maps parsing tools into parse content phrase", () => {
    const events = [
      {
        type: "tool_call",
        timestamp: 1,
        iteration: 0,
        data: { name: "web_fetch", tool_id: "tool-3", input: { url: "https://docs.example.com/guide" } },
      },
    ] as unknown as AgentEvent[];
    const toolCalls: ToolCallInfo[] = [
      { id: "tc-3", toolUseId: "tool-3", name: "web_fetch", input: { url: "https://docs.example.com/guide" }, timestamp: 1, output: "ok" },
    ];

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), t, agentNameMap);
    expect(steps[0]?.title).toBe("parse docs.example.com content");
  });

  it("falls back to unknown runtime target when search input is missing", () => {
    const events = [
      {
        type: "tool_call",
        timestamp: 1,
        iteration: 0,
        data: { name: "web_search", tool_id: "tool-4", input: {} },
      },
    ] as unknown as AgentEvent[];
    const toolCalls: ToolCallInfo[] = [
      { id: "tc-4", toolUseId: "tool-4", name: "web_search", input: {}, timestamp: 1, output: "ok" },
    ];

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), t, agentNameMap);
    expect(steps[0]?.title).toContain("searching");
  });
});
