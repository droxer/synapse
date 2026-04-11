import { describe, expect, it } from "@jest/globals";
import { deriveAgentState } from "./use-agent-state";
import type { AgentEvent } from "../../../shared/types";

describe("deriveAgentState", () => {
  it("uses llm_response.content when text is missing", () => {
    const events: AgentEvent[] = [
      {
        type: "llm_response",
        data: { content: "content fallback message" },
        timestamp: 1,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("content fallback message");
  });

  it("serializes non-string tool_result output", () => {
    const events: AgentEvent[] = [
      {
        type: "tool_call",
        data: { tool_id: "tool-1", tool_name: "web_search", tool_input: {} },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "tool_result",
        data: { tool_id: "tool-1", output: { ok: true, count: 2 } },
        timestamp: 2,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]?.output).toBe(JSON.stringify({ ok: true, count: 2 }));
  });

  it("keeps plan steps empty when planner turn has no plan_created event", () => {
    const events: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "plan this", orchestrator_mode: "planner" },
        timestamp: 1,
        iteration: null,
      },
      {
        type: "llm_response",
        data: { text: "Working on it" },
        timestamp: 2,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.planSteps).toHaveLength(0);
  });
});
