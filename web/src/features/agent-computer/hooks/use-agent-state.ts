"use client";

import { useMemo } from "react";
import type {
  AgentEvent,
  ChatMessage,
  ToolCallInfo,
  TaskState,
  AgentStatus,
} from "@/shared/types";

export function useAgentState(events: AgentEvent[]) {
  const messages = useMemo<ChatMessage[]>(() => {
    const msgs: ChatMessage[] = [];
    let streamingText = "";
    let streamingTimestamp = 0;

    for (const e of events) {
      if (e.type === "text_delta") {
        // Accumulate streaming text from deltas
        streamingText += String(e.data.delta ?? "");
        if (streamingTimestamp === 0) {
          streamingTimestamp = e.timestamp;
        }
      } else if (e.type === "llm_response") {
        // LLM response finalizes the streamed text
        const text = String(e.data.text ?? "");
        const toolCallCount = Number(e.data.tool_call_count ?? 0);
        // Reset streaming buffer — this response covers the accumulated deltas
        streamingText = "";
        streamingTimestamp = 0;
        if (text && toolCallCount === 0) {
          msgs.push({
            role: "assistant",
            content: text,
            timestamp: e.timestamp,
          });
        }
      } else if (e.type === "message_user") {
        msgs.push({
          role: "assistant",
          content: String(e.data.message ?? e.data.content ?? ""),
          timestamp: e.timestamp,
        });
      } else if (e.type === "turn_complete" || e.type === "task_complete") {
        const result = String(e.data.result ?? "");
        if (result) {
          const alreadyShown = msgs.some(
            (m) => m.role === "assistant" && m.content === result,
          );
          if (!alreadyShown) {
            msgs.push({
              role: "assistant",
              content: result,
              timestamp: e.timestamp,
            });
          }
        }
      } else if (e.type === "task_error") {
        const error = String(e.data.error ?? "An error occurred");
        msgs.push({
          role: "assistant",
          content: `Error: ${error}`,
          timestamp: e.timestamp,
        });
      }
    }

    // If there's still streaming text (deltas arrived but no llm_response yet),
    // show it as an in-progress message
    if (streamingText) {
      msgs.push({
        role: "assistant",
        content: streamingText,
        timestamp: streamingTimestamp,
      });
    }

    return msgs;
  }, [events]);

  const toolCalls = useMemo<ToolCallInfo[]>(() => {
    const calls: ToolCallInfo[] = [];
    const callMap = new Map<string, number>();

    for (const e of events) {
      if (e.type === "tool_call") {
        const toolId = String(e.data.tool_id ?? e.data.id ?? crypto.randomUUID());
        const idx = calls.length;
        callMap.set(toolId, idx);
        calls.push({
          id: toolId,
          name: String(e.data.name ?? e.data.tool_name ?? "unknown"),
          input: (e.data.input ?? e.data.arguments ?? {}) as Record<string, unknown>,
          timestamp: e.timestamp,
        });
      }
      if (e.type === "tool_result") {
        const toolId = String(e.data.tool_id ?? e.data.id ?? "");
        const idx = callMap.get(toolId);
        if (idx !== undefined) {
          calls[idx] = {
            ...calls[idx],
            output: String(e.data.output ?? e.data.result ?? ""),
            success: e.data.success !== false,
          };
        }
      }
    }

    return calls;
  }, [events]);

  const taskState = useMemo<TaskState>(() => {
    let state: TaskState = "idle";
    for (const e of events) {
      if (e.type === "turn_start" || e.type === "task_start") state = "executing";
      if (e.type === "agent_spawn") state = "planning";
      if (e.type === "iteration_start") state = "executing";
      if (e.type === "tool_call") state = "executing";
      if (e.type === "turn_complete") state = "idle";
      if (e.type === "task_complete") state = "complete";
      if (e.type === "task_error") state = "error";
    }
    return state;
  }, [events]);

  const agentStatuses = useMemo<AgentStatus[]>(() => {
    const agentMap = new Map<string, AgentStatus>();

    for (const e of events) {
      if (e.type === "agent_spawn") {
        const agentId = String(e.data.agent_id ?? e.data.id ?? "");
        agentMap.set(agentId, {
          agentId,
          description: String(e.data.description ?? e.data.task ?? ""),
          status: "running",
        });
      }
      if (e.type === "agent_complete") {
        const agentId = String(e.data.agent_id ?? e.data.id ?? "");
        const existing = agentMap.get(agentId);
        if (existing) {
          agentMap.set(agentId, {
            ...existing,
            status: e.data.error ? "error" : "complete",
          });
        }
      }
    }

    return Array.from(agentMap.values());
  }, [events]);

  const currentIteration = useMemo<number>(() => {
    let iteration = 0;
    for (const e of events) {
      if (e.iteration !== null && e.iteration > iteration) {
        iteration = e.iteration;
      }
    }
    return iteration;
  }, [events]);

  const reasoningSteps = useMemo<string[]>(() => {
    return events
      .filter((e) => e.type === "llm_response")
      .map((e) => String(e.data.text ?? e.data.content ?? e.data.message ?? ""))
      .filter((text) => text.length > 0);
  }, [events]);

  const thinkingContent = useMemo<string>(() => {
    const thinkingEvents = events.filter((e) => e.type === "thinking");
    if (thinkingEvents.length === 0) return "";
    return thinkingEvents
      .map((e) => String(e.data.text ?? e.data.content ?? ""))
      .join("\n");
  }, [events]);

  return {
    messages,
    toolCalls,
    taskState,
    agentStatuses,
    currentIteration,
    reasoningSteps,
    thinkingContent,
  };
}
