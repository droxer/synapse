"use client";

import { useMemo } from "react";
import type {
  AgentEvent,
  ArtifactInfo,
  AssistantPhase,
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
        if (text) {
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
      } else if (e.type === "turn_cancelled") {
        // Finalize any streaming text as a partial message
        if (streamingText) {
          msgs.push({
            role: "assistant",
            content: streamingText,
            timestamp: streamingTimestamp,
          });
          streamingText = "";
          streamingTimestamp = 0;
        }
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

    // Diagnostic logging — remove after verifying the fix
    if (events.length > 0) {
      console.log("[useAgentState] events:", events.map((e) => e.type));
      console.log("[useAgentState] messages:", msgs.map((m) => ({ role: m.role, len: m.content.length })));
      const completionEvents = events.filter(
        (e) => e.type === "turn_complete" || e.type === "task_complete",
      );
      if (completionEvents.length > 0) {
        console.log("[useAgentState] completion events:", completionEvents.map((e) => ({
          type: e.type,
          resultLen: String(e.data.result ?? "").length,
        })));
      }
    }

    return msgs;
  }, [events]);

  const toolCalls = useMemo<ToolCallInfo[]>(() => {
    const callMap = new Map<string, ToolCallInfo>();
    const insertOrder: string[] = [];

    for (const e of events) {
      if (e.type === "tool_call") {
        const toolId = String(e.data.tool_id ?? e.data.id ?? crypto.randomUUID());
        const agentId = e.data.agent_id ? String(e.data.agent_id) : undefined;
        const entry: ToolCallInfo = {
          id: toolId,
          name: String(e.data.name ?? e.data.tool_name ?? "unknown"),
          input: (e.data.input ?? e.data.tool_input ?? e.data.arguments ?? {}) as Record<string, unknown>,
          timestamp: e.timestamp,
          agentId,
        };
        callMap.set(toolId, entry);
        insertOrder.push(toolId);
      }
      if (e.type === "tool_result") {
        const toolId = String(e.data.tool_id ?? e.data.id ?? "");
        const existing = callMap.get(toolId);
        if (existing) {
          const agentId = e.data.agent_id ? String(e.data.agent_id) : existing.agentId;
          callMap.set(toolId, {
            ...existing,
            output: String(e.data.output ?? e.data.result ?? ""),
            success: e.data.success !== false,
            contentType: e.data.content_type
              ? String(e.data.content_type)
              : undefined,
            artifactIds: Array.isArray(e.data.artifact_ids)
              ? (e.data.artifact_ids as string[])
              : undefined,
            agentId,
          });
        }
      }
      if (e.type === "code_result") {
        // Associate code_result with the most recent code tool call that has no output yet
        const codeToolNames = new Set(["code_run", "code_interpret", "shell_exec"]);
        let targetId: string | undefined;
        for (let i = insertOrder.length - 1; i >= 0; i--) {
          const id = insertOrder[i];
          const call = callMap.get(id);
          if (call && codeToolNames.has(call.name) && call.output === undefined) {
            targetId = id;
            break;
          }
        }
        if (targetId) {
          const existing = callMap.get(targetId)!;
          callMap.set(targetId, {
            ...existing,
            output: String(e.data.output ?? e.data.result ?? ""),
            success: e.data.success !== false,
            contentType: e.data.content_type
              ? String(e.data.content_type)
              : "text/plain",
          });
        }
      }
    }

    return insertOrder
      .map((id) => callMap.get(id))
      .filter((c): c is ToolCallInfo => c !== undefined);
  }, [events]);

  const taskState = useMemo<TaskState>(() => {
    let state: TaskState = "idle";
    for (const e of events) {
      if (e.type === "turn_start" || e.type === "task_start") state = "executing";
      if (e.type === "agent_spawn") state = "planning";
      if (e.type === "iteration_start") state = "executing";
      if (e.type === "tool_call") state = "executing";
      if (e.type === "turn_complete") state = "idle";
      if (e.type === "turn_cancelled") state = "idle";
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

  const isStreaming = useMemo<boolean>(() => {
    let hasUnfinalizedDeltas = false;
    for (const e of events) {
      if (e.type === "text_delta") {
        hasUnfinalizedDeltas = true;
      } else if (
        e.type === "llm_response" ||
        e.type === "turn_complete" ||
        e.type === "turn_cancelled" ||
        e.type === "task_complete" ||
        e.type === "task_error"
      ) {
        hasUnfinalizedDeltas = false;
      }
    }
    return hasUnfinalizedDeltas;
  }, [events]);

  const assistantPhase = useMemo<AssistantPhase>(() => {
    let phase: AssistantPhase = { phase: "idle" };
    const pendingToolIds = new Set<string>();

    for (const e of events) {
      if (e.type === "thinking") {
        phase = { phase: "thinking" };
      } else if (e.type === "text_delta") {
        phase = { phase: "writing" };
      } else if (e.type === "llm_response") {
        phase = { phase: "idle" };
      } else if (e.type === "tool_call") {
        const toolId = String(e.data.tool_id ?? e.data.id ?? "");
        const toolName = String(e.data.name ?? e.data.tool_name ?? "tool");
        pendingToolIds.add(toolId);
        phase = { phase: "using_tool", toolName };
      } else if (e.type === "tool_result") {
        const toolId = String(e.data.tool_id ?? e.data.id ?? "");
        pendingToolIds.delete(toolId);
        if (pendingToolIds.size === 0) {
          phase = { phase: "idle" };
        }
      } else if (
        e.type === "task_complete" ||
        e.type === "turn_complete" ||
        e.type === "turn_cancelled" ||
        e.type === "task_error"
      ) {
        phase = { phase: "idle" };
        pendingToolIds.clear();
      }
    }

    return phase;
  }, [events]);

  const artifacts = useMemo<ArtifactInfo[]>(() => {
    return events
      .filter((e) => e.type === "artifact_created")
      .map((e) => ({
        id: String(e.data.artifact_id ?? crypto.randomUUID()),
        name: String(e.data.name ?? ""),
        contentType: String(e.data.content_type ?? "application/octet-stream"),
        size: Number(e.data.size ?? 0),
      }));
  }, [events]);

  return {
    messages,
    toolCalls,
    taskState,
    agentStatuses,
    currentIteration,
    reasoningSteps,
    thinkingContent,
    isStreaming,
    assistantPhase,
    artifacts,
  };
}
