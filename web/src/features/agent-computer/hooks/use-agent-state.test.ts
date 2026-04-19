import { describe, expect, it } from "@jest/globals";
import { deriveAgentState, stabilizeDerivedAgentState } from "./use-agent-state";
import type { AgentEvent } from "../../../shared/types";

describe("deriveAgentState", () => {
  it("strips inline redacted_thinking blocks from llm_response text into thinkingContent", () => {
    const events: AgentEvent[] = [
      {
        type: "llm_response",
        data: {
          text: "<redacted_thinking>plan A</redacted_thinking>\n\nHello **world**",
        },
        timestamp: 1,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("Hello **world**");
    expect(state.messages[0]?.thinkingContent).toBe("plan A");
  });

  it("strips legacy think blocks and merges with prior thinking events", () => {
    const events: AgentEvent[] = [
      {
        type: "thinking",
        data: { thinking: "from event" },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "llm_response",
        data: { text: "<redacted_thinking>inline</think>Done." },
        timestamp: 2,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages[0]?.content).toBe("Done.");
    expect(state.messages[0]?.thinkingContent).toContain("from event");
    expect(state.messages[0]?.thinkingContent).toContain("inline");
  });

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

  it("timestamps llm_response messages at the response event, not first text_delta", () => {
    const events: AgentEvent[] = [
      {
        type: "text_delta",
        data: { delta: "hello" },
        timestamp: 10,
        iteration: 1,
      },
      {
        type: "llm_response",
        data: { text: "hello" },
        timestamp: 99,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages[0]?.timestamp).toBe(99);
  });

  it("adds attachment metadata to user messages from turn_start events", () => {
    const events: AgentEvent[] = [
      {
        type: "turn_start",
        data: {
          message: "inspect this",
          attachments: [{ name: "report.csv", size: 42, type: "text/csv" }],
        },
        timestamp: 10,
        iteration: null,
      },
    ];

    const state = deriveAgentState(events);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      role: "user",
      content: "inspect this",
      attachments: [{ name: "report.csv", size: 42, type: "text/csv" }],
    });
  });

  it("keeps in-flight streaming message timestamp at first text_delta", () => {
    const events: AgentEvent[] = [
      {
        type: "text_delta",
        data: { delta: "Hello" },
        timestamp: 10,
        iteration: 1,
      },
      {
        type: "text_delta",
        data: { delta: " world" },
        timestamp: 20,
        iteration: 1,
      },
      {
        type: "text_delta",
        data: { delta: "!" },
        timestamp: 30,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("Hello world!");
    expect(state.messages[0]?.timestamp).toBe(10);
  });

  it("ignores worker text_delta events when building the main assistant stream", () => {
    const events: AgentEvent[] = [
      {
        type: "text_delta",
        data: { delta: "worker draft", agent_id: "agent-1" },
        timestamp: 10,
        iteration: 1,
      },
      {
        type: "text_delta",
        data: { delta: "Main answer" },
        timestamp: 20,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("Main answer");
    expect(state.messages[0]?.timestamp).toBe(20);
  });

  it("does not duplicate final assistant message when turn_complete differs only by trailing whitespace", () => {
    const events: AgentEvent[] = [
      {
        type: "llm_response",
        data: { text: "Deep research summary" },
        timestamp: 100,
        iteration: 1,
      },
      {
        type: "turn_complete",
        data: { result: "Deep research summary\n\n" },
        timestamp: 110,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("Deep research summary");
  });

  it("does not materialize terminal llm_response when turn_complete finalizes the same turn", () => {
    const events: AgentEvent[] = [
      {
        type: "text_delta",
        data: { delta: "Deep research " },
        timestamp: 10,
        iteration: 1,
      },
      {
        type: "text_delta",
        data: { delta: "summary" },
        timestamp: 20,
        iteration: 1,
      },
      {
        type: "llm_response",
        data: { text: "Deep research summary", stop_reason: "end_turn" },
        timestamp: 30,
        iteration: 1,
      },
      {
        type: "turn_complete",
        data: { result: "Deep research summary" },
        timestamp: 40,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("Deep research summary");
  });

  it("does not duplicate when message_user matches streamed text (task agents emit no llm_response)", () => {
    const events: AgentEvent[] = [
      {
        type: "text_delta",
        data: { delta: "Full research " },
        timestamp: 10,
        iteration: 1,
      },
      {
        type: "text_delta",
        data: { delta: "report" },
        timestamp: 20,
        iteration: 1,
      },
      {
        type: "message_user",
        data: { message: "Full research report" },
        timestamp: 30,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("Full research report");
  });

  it("does not duplicate when turn_complete matches streamed text without a terminal llm_response", () => {
    const events: AgentEvent[] = [
      {
        type: "text_delta",
        data: { delta: "Same body" },
        timestamp: 10,
        iteration: 1,
      },
      {
        type: "turn_complete",
        data: { result: "Same body" },
        timestamp: 40,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("Same body");
  });

  it("materializes final assistant message from task_complete.summary", () => {
    const events: AgentEvent[] = [
      {
        type: "text_delta",
        data: { delta: "Final " },
        timestamp: 10,
        iteration: 1,
      },
      {
        type: "task_complete",
        data: { summary: "Final answer" },
        timestamp: 20,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("Final answer");
  });

  it("accepts legacy task_complete.result fallback", () => {
    const events: AgentEvent[] = [
      {
        type: "task_complete",
        data: { result: "Legacy result" },
        timestamp: 20,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("Legacy result");
  });

  it("renders deep-research thinking-only payloads as assistant content fallback", () => {
    const events: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "Research this topic" },
        timestamp: 1,
        iteration: null,
      },
      {
        type: "tool_call",
        data: {
          tool_id: "tool-deep-research",
          tool_name: "activate_skill",
          tool_input: { name: "deep-research" },
        },
        timestamp: 2,
        iteration: 1,
      },
      {
        type: "thinking",
        data: { thinking: "Deep research summary content" },
        timestamp: 3,
        iteration: 1,
      },
      {
        type: "turn_complete",
        data: { result: "" },
        timestamp: 4,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    const assistantMessages = state.messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("Deep research summary content");
    expect(assistantMessages[0]?.thinkingContent).toBeUndefined();
    expect(assistantMessages[0]?.thinkingEntries).toBeUndefined();
  });

  it("keeps non deep-research thinking in thinking metadata", () => {
    const events: AgentEvent[] = [
      {
        type: "thinking",
        data: { thinking: "Reasoning trace" },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "turn_complete",
        data: { result: "Final answer" },
        timestamp: 2,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    const assistantMessages = state.messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("Final answer");
    expect(assistantMessages[0]?.thinkingContent).toContain("Reasoning trace");
    expect(assistantMessages[0]?.thinkingEntries?.[0]?.content).toBe("Reasoning trace");
  });

  it("keeps partial streamed assistant text visible when a turn ends with task_error", () => {
    const events: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "hello" },
        timestamp: 1,
        iteration: null,
      },
      {
        type: "text_delta",
        data: { delta: "Partial answer" },
        timestamp: 2,
        iteration: 1,
      },
      {
        type: "task_error",
        data: { error: "Connection to backend lost before the turn finished." },
        timestamp: 3,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.taskState).toBe("error");
    expect(state.isStreaming).toBe(false);
    expect(state.assistantPhase).toEqual({ phase: "idle" });
    expect(state.messages).toHaveLength(3);
    expect(state.messages[1]?.content).toBe("Partial answer");
    expect(state.messages[2]?.content).toContain("Connection to backend lost");
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

  it("streams sandbox stdout/stderr into active shell/code tool output", () => {
    const events: AgentEvent[] = [
      {
        type: "tool_call",
        data: { tool_id: "tool-2", tool_name: "shell_exec", tool_input: { command: "echo hi" } },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "sandbox_stdout",
        data: { text: "line 1\n" },
        timestamp: 2,
        iteration: 1,
      },
      {
        type: "sandbox_stderr",
        data: { text: "warn\n" },
        timestamp: 3,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]?.output).toBe("line 1\nstderr: warn\n");
    expect(state.toolCalls[0]?.success).toBeUndefined();
  });

  it("replaces streamed output with final tool_result output", () => {
    const events: AgentEvent[] = [
      {
        type: "tool_call",
        data: { tool_id: "tool-3", tool_name: "code_run", tool_input: { language: "bash", code: "echo done" } },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "sandbox_stdout",
        data: { text: "partial\n" },
        timestamp: 2,
        iteration: 1,
      },
      {
        type: "tool_result",
        data: { tool_id: "tool-3", output: "final\n", success: true },
        timestamp: 3,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]?.output).toBe("final\n");
    expect(state.toolCalls[0]?.success).toBe(true);
  });

  it("reuses an existing non-skill tool row when tool_call is replayed", () => {
    const events: AgentEvent[] = [
      {
        type: "tool_call",
        data: { tool_id: "tool-replay", tool_name: "web_search", tool_input: { query: "deep search" } },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "tool_result",
        data: { tool_id: "tool-replay", output: "ok", success: true },
        timestamp: 2,
        iteration: 1,
      },
      {
        type: "tool_call",
        data: { tool_id: "tool-replay", tool_name: "web_search", tool_input: { query: "deep search" } },
        timestamp: 3,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]?.toolUseId).toBe("tool-replay");
    expect(state.toolCalls[0]?.output).toBe("ok");
    expect(state.toolCalls[0]?.success).toBe(true);
  });

  it("creates a synthetic completed skill row for auto-selected skills", () => {
    const events: AgentEvent[] = [
      {
        type: "skill_activated",
        data: { name: "frontend-design", source: "auto" },
        timestamp: 1,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]?.name).toBe("activate_skill");
    expect(state.toolCalls[0]?.input.name).toBe("frontend-design");
    expect(state.toolCalls[0]?.success).toBe(true);
  });

  it("prefers tool_name over name when both appear on tool_call (backend canonical field)", () => {
    const events: AgentEvent[] = [
      {
        type: "tool_call",
        data: {
          tool_id: "tool-x",
          name: "docx",
          tool_name: "activate_skill",
          tool_input: { name: "docx" },
        },
        timestamp: 1,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]?.name).toBe("activate_skill");
  });

  it("marks activate_skill as failed immediately when tool_result reports success false", () => {
    const events: AgentEvent[] = [
      {
        type: "tool_call",
        data: { tool_id: "tool-bad", tool_name: "activate_skill", tool_input: { name: "nope" } },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "tool_result",
        data: {
          tool_id: "tool-bad",
          output: "Skill 'nope' not found. Available skills: a, b",
          success: false,
        },
        timestamp: 2,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]?.success).toBe(false);
    expect(state.toolCalls[0]?.output).toContain("not found");
  });

  it("keeps explicit activate_skill pending until setup resolves and marks failures inline", () => {
    const events: AgentEvent[] = [
      {
        type: "tool_call",
        data: { tool_id: "tool-9", tool_name: "activate_skill", tool_input: { name: "docx" } },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "tool_result",
        data: { tool_id: "tool-9", output: "<skill_content name=\"docx\">...</skill_content>", success: true },
        timestamp: 2,
        iteration: 1,
      },
      {
        type: "skill_setup_failed",
        data: { name: "docx", source: "explicit", phase: "dependencies", error: "pip install failed" },
        timestamp: 3,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]?.success).toBe(false);
    expect(state.toolCalls[0]?.output).toContain("dependencies");
    expect(state.toolCalls[0]?.output).toContain("pip install failed");
  });

  it("preserves skipped agent terminal state from agent_complete", () => {
    const events: AgentEvent[] = [
      {
        type: "agent_spawn",
        data: { agent_id: "agent-1", name: "researcher", description: "Research docs" },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "agent_complete",
        data: { agent_id: "agent-1", terminal_state: "skipped" },
        timestamp: 2,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.agentStatuses).toHaveLength(1);
    expect(state.agentStatuses[0]?.status).toBe("skipped");
  });

  it("sets artifact createdAt from event timestamp on artifact_created", () => {
    const ts = new Date("2026-01-15T14:30:00.000Z").getTime();
    const events: AgentEvent[] = [
      {
        type: "artifact_created",
        data: {
          artifact_id: "art-1",
          name: "report.pdf",
          content_type: "application/pdf",
          size: 1024,
          file_path: "outputs/report.pdf",
        },
        timestamp: ts,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]?.createdAt).toBe("2026-01-15T14:30:00.000Z");
    expect(state.artifacts[0]?.filePath).toBe("outputs/report.pdf");
  });

  it("preserves replan_required status from dedicated agent events", () => {
    const events: AgentEvent[] = [
      {
        type: "agent_spawn",
        data: { agent_id: "agent-2", name: "builder", description: "Build feature" },
        timestamp: 1,
        iteration: 1,
      },
      {
        type: "agent_replan_required",
        data: { agent_id: "agent-2" },
        timestamp: 2,
        iteration: 1,
      },
      {
        type: "agent_complete",
        data: { agent_id: "agent-2", terminal_state: "replan_required" },
        timestamp: 3,
        iteration: 1,
      },
    ];

    const state = deriveAgentState(events);
    expect(state.agentStatuses).toHaveLength(1);
    expect(state.agentStatuses[0]?.status).toBe("replan_required");
  });

  it("reuses unchanged earlier message objects when only the streaming tail grows", () => {
    const earlyEvents: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "hello" },
        timestamp: 1,
        iteration: null,
      },
      {
        type: "text_delta",
        data: { delta: "Part 1" },
        timestamp: 2,
        iteration: 1,
      },
    ];
    const laterEvents: AgentEvent[] = [
      ...earlyEvents,
      {
        type: "text_delta",
        data: { delta: " and Part 2" },
        timestamp: 3,
        iteration: 1,
      },
    ];

    const prev = deriveAgentState(earlyEvents);
    const next = deriveAgentState(laterEvents);
    const stabilized = stabilizeDerivedAgentState(prev, next);

    expect(stabilized.messages).toHaveLength(2);
    expect(stabilized.messages[0]).toBe(prev.messages[0]);
    expect(stabilized.messages[1]).not.toBe(prev.messages[1]);
    expect(stabilized.messages[1]?.messageId).toBe(prev.messages[1]?.messageId);
    expect(stabilized.messages[1]?.content).toBe("Part 1 and Part 2");
  });
});
