import { describe, expect, it } from "@jest/globals";
import {
  buildDisplaySteps,
  buildSteps,
  buildToolCallIndexes,
  isTimelineStepActionable,
} from "./AgentProgressCard";
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

  it("ignores hidden communication tools in grouped counts", () => {
    const calls: ToolCallInfo[] = [
      {
        id: "tc-1",
        toolUseId: "hidden-id",
        name: "message_user",
        input: {},
        timestamp: 1,
        agentId: "agent-1",
      },
      {
        id: "tc-2",
        toolUseId: "visible-id",
        name: "web_search",
        input: {},
        timestamp: 2,
        agentId: "agent-1",
      },
    ];

    const indexes = buildToolCallIndexes(calls);
    expect(indexes.byToolUseId.has("hidden-id")).toBe(false);
    expect(indexes.countByAgentId.get("agent-1")).toBe(1);
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
      case "progress.loadingSkill":
        return `Loading ${params?.name ?? ""} skill`;
      case "progress.skillLoaded":
        return `Loaded ${params?.name ?? ""}`;
      case "progress.skillLoadFailed":
        return `Failed ${params?.name ?? ""}`;
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

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), toolCalls, t, agentNameMap);
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

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), toolCalls, t, agentNameMap);
    expect(steps[0]?.title).toContain("Loading");
    expect(steps[0]?.title).toContain("Frontend Design");
    expect(steps[0]?.title).toContain("skill");
  });

  it("marks explicit skill steps complete only after skill_activated", () => {
    const events = [
      {
        type: "tool_call",
        timestamp: 1,
        iteration: 0,
        data: { name: "activate_skill", tool_id: "tool-5", input: { name: "frontend-design" } },
      },
      {
        type: "skill_activated",
        timestamp: 2,
        iteration: 0,
        data: { name: "frontend-design", source: "explicit" },
      },
    ] as unknown as AgentEvent[];
    const toolCalls: ToolCallInfo[] = [
      { id: "tc-5", toolUseId: "tool-5", name: "activate_skill", input: { name: "frontend-design" }, timestamp: 1 },
    ];

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), toolCalls, t, agentNameMap);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe("complete");
    expect(steps[0]?.title).toBe("Loaded Frontend Design");
  });

  it("merges tool_call into a synthetic skill row when skill_activated arrived first", () => {
    const events = [
      {
        type: "skill_activated",
        timestamp: 1,
        iteration: 0,
        data: { name: "frontend-design", source: "already_active" },
      },
      {
        type: "tool_call",
        timestamp: 2,
        iteration: 0,
        data: { name: "activate_skill", tool_id: "tool-9", input: { name: "frontend-design" } },
      },
    ] as unknown as AgentEvent[];
    const toolCalls: ToolCallInfo[] = [
      { id: "tc-9", toolUseId: "tool-9", name: "activate_skill", input: { name: "frontend-design" }, timestamp: 2 },
    ];

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), toolCalls, t, agentNameMap);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe("skill");
    expect(steps[0]?.rawToolName).toBe("activate_skill");
    expect(steps[0]?.status).toBe("complete");
    expect(steps[0]?.title).toBe("Loaded Frontend Design");
  });

  it("renders loaded title when skill_activated arrives without a tool_call", () => {
    const events = [
      {
        type: "skill_activated",
        timestamp: 1,
        iteration: 0,
        data: { name: "deep-research", source: "auto" },
      },
    ] as unknown as AgentEvent[];

    const steps = buildSteps(events, buildToolCallIndexes([]), [], t, agentNameMap);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe("skill");
    expect(steps[0]?.status).toBe("complete");
    expect(steps[0]?.title).toBe("Loaded Deep Research");
  });

  it("renders an optimistic selected skill before backend confirmation", () => {
    const toolCalls: ToolCallInfo[] = [
      {
        id: "optimistic-1",
        toolUseId: "optimistic-skill:frontend-design",
        name: "activate_skill",
        input: { name: "frontend-design" },
        timestamp: 50,
      },
    ];

    const steps = buildSteps([], buildToolCallIndexes(toolCalls), toolCalls, t, agentNameMap);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe("skill");
    expect(steps[0]?.status).toBe("running");
    expect(steps[0]?.title).toBe("Loading Frontend Design skill");
  });

  it("replaces the optimistic selected skill once the backend confirms it", () => {
    const events = [
      {
        type: "skill_activated",
        timestamp: 100,
        iteration: 0,
        data: { name: "frontend-design", source: "explicit" },
      },
    ] as unknown as AgentEvent[];
    const toolCalls: ToolCallInfo[] = [
      {
        id: "optimistic-1",
        toolUseId: "optimistic-skill:frontend-design",
        name: "activate_skill",
        input: { name: "frontend-design" },
        timestamp: 50,
      },
    ];

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), toolCalls, t, agentNameMap);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe("complete");
    expect(steps[0]?.title).toBe("Loaded Frontend Design");
  });

  it("creates an error skill step for auto-selected setup failures", () => {
    const events = [
      {
        type: "skill_setup_failed",
        timestamp: 1,
        iteration: 0,
        data: { name: "docx", source: "auto", phase: "dependencies", error: "pip install failed" },
      },
    ] as unknown as AgentEvent[];

    const steps = buildSteps(events, buildToolCallIndexes([]), [], t, agentNameMap);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe("skill");
    expect(steps[0]?.status).toBe("error");
    expect(steps[0]?.title).toBe("Failed Docx");
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

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), toolCalls, t, agentNameMap);
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

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), toolCalls, t, agentNameMap);
    expect(steps[0]?.title).toContain("searching");
  });

  it("does not show message user tool calls in the progress timeline", () => {
    const events = [
      {
        type: "tool_call",
        timestamp: 1,
        iteration: 0,
        data: { name: "message_user", tool_id: "tool-5", input: { message: "Need input" } },
      },
      {
        type: "tool_call",
        timestamp: 2,
        iteration: 0,
        data: { name: "web_search", tool_id: "tool-6", input: { query: "docs" } },
      },
    ] as unknown as AgentEvent[];
    const toolCalls: ToolCallInfo[] = [
      { id: "tc-5", toolUseId: "tool-5", name: "message_user", input: { message: "Need input" }, timestamp: 1, output: "ok" },
      { id: "tc-6", toolUseId: "tool-6", name: "web_search", input: { query: "docs" }, timestamp: 2, output: "ok" },
    ];

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), toolCalls, t, agentNameMap);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.rawToolName).toBe("web_search");
  });

  it("marks failed tool calls as error instead of complete", () => {
    const events = [
      {
        type: "tool_call",
        timestamp: 1,
        iteration: 0,
        data: { name: "web_fetch", tool_id: "tool-7", input: { url: "https://example.com" } },
      },
    ] as unknown as AgentEvent[];
    const toolCalls: ToolCallInfo[] = [
      {
        id: "tc-7",
        toolUseId: "tool-7",
        name: "web_fetch",
        input: { url: "https://example.com" },
        timestamp: 1,
        output: "network failed",
        success: false,
      },
    ];

    const steps = buildSteps(events, buildToolCallIndexes(toolCalls), toolCalls, t, agentNameMap);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe("error");
  });

  it("preserves skipped and replan-required agent outcomes", () => {
    const events = [
      {
        type: "agent_spawn",
        timestamp: 1,
        iteration: 0,
        data: { agent_id: "agent-skip", name: "researcher" },
      },
      {
        type: "agent_complete",
        timestamp: 2,
        iteration: 0,
        data: { agent_id: "agent-skip", terminal_state: "skipped" },
      },
      {
        type: "agent_spawn",
        timestamp: 3,
        iteration: 0,
        data: { agent_id: "agent-replan", name: "builder" },
      },
      {
        type: "agent_complete",
        timestamp: 4,
        iteration: 0,
        data: { agent_id: "agent-replan", terminal_state: "replan_required" },
      },
    ] as unknown as AgentEvent[];

    const steps = buildSteps(events, buildToolCallIndexes([]), [], t, agentNameMap);
    expect(steps.find((step) => step.id.startsWith("agent-agent-skip-"))?.status).toBe("skipped");
    expect(steps.find((step) => step.id.startsWith("agent-agent-replan-"))?.status).toBe("replan_required");
  });
});

describe("buildDisplaySteps", () => {
  const t = createTestTranslator();

  it("returns existing steps unchanged when events already produced timeline rows", () => {
    const existing = [
      {
        id: "start-1",
        kind: "start",
        title: "progress.taskStarted",
        status: "complete",
      },
    ] as const;
    const output = buildDisplaySteps(existing, "executing", false, t);
    expect(output).toHaveLength(1);
    expect(output[0]?.id).toBe("start-1");
  });

  it("shows a running bootstrap step while waiting for first event", () => {
    const output = buildDisplaySteps([], "idle", true, t);
    expect(output).toHaveLength(1);
    expect(output[0]?.status).toBe("running");
    expect(output[0]?.title).toBe("progress.taskStarted");
  });

  it("keeps timeline empty when idle and not waiting", () => {
    expect(buildDisplaySteps([], "idle", false, t)).toHaveLength(0);
  });
});
