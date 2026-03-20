"use client";

import { useMemo } from "react";
import type {
  AgentEvent,
  ArtifactInfo,
  AssistantPhase,
  BrowserMetadata,
  ComputerUseMetadata,
  ChatMessage,
  ToolCallInfo,
  TaskState,
  AgentStatus,
  PlanStep,
} from "@/shared/types";

export function useAgentState(events: AgentEvent[]) {
  const messages = useMemo<ChatMessage[]>(() => {
    const msgs: ChatMessage[] = [];
    let streamingText = "";
    let streamingTimestamp = 0;
    // Track image artifact IDs from tool results; attach to the next assistant message
    let pendingImageArtifactIds: string[] = [];
    // Track which artifact IDs are images
    const imageArtifactIdSet = new Set<string>();

    for (const e of events) {
      // Collect image artifact IDs from artifact_created events
      if (e.type === "artifact_created") {
        const contentType = String(e.data.content_type ?? "");
        if (contentType.startsWith("image/")) {
          imageArtifactIdSet.add(String(e.data.artifact_id ?? ""));
        }
      }

      // Collect artifact IDs from tool_result events that are images
      if (e.type === "tool_result") {
        const artifactIds = Array.isArray(e.data.artifact_ids)
          ? (e.data.artifact_ids as string[])
          : [];
        for (const aid of artifactIds) {
          if (imageArtifactIdSet.has(aid)) {
            pendingImageArtifactIds.push(aid);
          }
        }
      }

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
          const msg: ChatMessage = {
            role: "assistant",
            content: text,
            timestamp: e.timestamp,
          };
          // Attach any pending image artifacts to this message
          if (pendingImageArtifactIds.length > 0) {
            msg.imageArtifactIds = pendingImageArtifactIds;
            pendingImageArtifactIds = [];
          }
          msgs.push(msg);
        }
      } else if (e.type === "message_user") {
        const msg: ChatMessage = {
          role: "assistant",
          content: String(e.data.message ?? e.data.content ?? ""),
          timestamp: e.timestamp,
        };
        if (pendingImageArtifactIds.length > 0) {
          msg.imageArtifactIds = pendingImageArtifactIds;
          pendingImageArtifactIds = [];
        }
        msgs.push(msg);
      } else if (e.type === "turn_cancelled") {
        // Finalize any streaming text as a partial message
        if (streamingText) {
          const msg: ChatMessage = {
            role: "assistant",
            content: streamingText,
            timestamp: streamingTimestamp,
          };
          if (pendingImageArtifactIds.length > 0) {
            msg.imageArtifactIds = pendingImageArtifactIds;
            pendingImageArtifactIds = [];
          }
          msgs.push(msg);
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
            const msg: ChatMessage = {
              role: "assistant",
              content: result,
              timestamp: e.timestamp,
            };
            if (pendingImageArtifactIds.length > 0) {
              msg.imageArtifactIds = pendingImageArtifactIds;
              pendingImageArtifactIds = [];
            }
            msgs.push(msg);
          } else if (pendingImageArtifactIds.length > 0) {
            // Attach to the existing matching message
            const existing = msgs.findLast(
              (m) => m.role === "assistant" && m.content === result,
            );
            if (existing) {
              existing.imageArtifactIds = [
                ...(existing.imageArtifactIds ?? []),
                ...pendingImageArtifactIds,
              ];
            }
            pendingImageArtifactIds = [];
          }
        } else if (pendingImageArtifactIds.length > 0) {
          // No result text but have pending images — attach to last assistant message
          const lastAssistant = msgs.findLast((m) => m.role === "assistant");
          if (lastAssistant) {
            lastAssistant.imageArtifactIds = [
              ...(lastAssistant.imageArtifactIds ?? []),
              ...pendingImageArtifactIds,
            ];
          }
          pendingImageArtifactIds = [];
        }
      } else if (e.type === "task_error") {
        const error = String(e.data.error ?? "An error occurred");
        msgs.push({
          role: "assistant",
          content: `Error: ${error}`,
          timestamp: e.timestamp,
        });
        pendingImageArtifactIds = [];
      }
    }

    // If there's still streaming text (deltas arrived but no llm_response yet),
    // show it as an in-progress message
    if (streamingText) {
      const msg: ChatMessage = {
        role: "assistant",
        content: streamingText,
        timestamp: streamingTimestamp,
      };
      if (pendingImageArtifactIds.length > 0) {
        msg.imageArtifactIds = pendingImageArtifactIds;
        pendingImageArtifactIds = [];
      }
      msgs.push(msg);
    }

    // If there are still pending image artifacts, attach to last assistant message
    if (pendingImageArtifactIds.length > 0) {
      const lastAssistant = msgs.findLast((m) => m.role === "assistant");
      if (lastAssistant) {
        lastAssistant.imageArtifactIds = [
          ...(lastAssistant.imageArtifactIds ?? []),
          ...pendingImageArtifactIds,
        ];
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
          const browserMeta: BrowserMetadata | undefined = existing.name === "browser_use" ? {
            steps: typeof e.data.steps === "number" ? e.data.steps : undefined,
            isDone: typeof e.data.is_done === "boolean" ? e.data.is_done : undefined,
            maxSteps: typeof e.data.max_steps === "number" ? e.data.max_steps : undefined,
            url: typeof e.data.url === "string" ? e.data.url : undefined,
            task: typeof e.data.task === "string" ? e.data.task : undefined,
          } : undefined;
          const computerUseMeta: ComputerUseMetadata | undefined =
            (existing.name === "computer_action" || existing.name === "computer_screenshot")
              ? {
                  action: typeof e.data.action === "string" ? e.data.action : undefined,
                  x: typeof e.data.x === "number" ? e.data.x : undefined,
                  y: typeof e.data.y === "number" ? e.data.y : undefined,
                  text: typeof e.data.text === "string" ? e.data.text : undefined,
                  endX: typeof e.data.end_x === "number" ? e.data.end_x : undefined,
                  endY: typeof e.data.end_y === "number" ? e.data.end_y : undefined,
                  amount: typeof e.data.amount === "number" ? e.data.amount : undefined,
                }
              : undefined;
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
            browserMetadata: browserMeta,
            computerUseMetadata: computerUseMeta,
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
          name: String(e.data.name ?? ""),
          description: String(e.data.description ?? e.data.task ?? ""),
          status: "running",
          timestamp: e.timestamp,
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
      if (e.type === "agent_handoff") {
        const parentId = String(e.data.parent_agent_id ?? "");
        const targetRole = String(e.data.target_role ?? "");
        const reason = String(e.data.reason ?? "");
        const existing = agentMap.get(parentId);
        if (existing) {
          const handoffNote = reason
            ? `Handed off to ${targetRole}: ${reason}`
            : `Handed off to ${targetRole}`;
          agentMap.set(parentId, {
            ...existing,
            description: `${existing.description} → ${handoffNote}`,
            status: "running",
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

  const activeSkill = useMemo<string | null>(() => {
    let skill: string | null = null;
    for (const e of events) {
      if (e.type === "skill_activated") {
        skill = String(e.data.name ?? null);
      } else if (e.type === "turn_start") {
        skill = null;
      }
    }
    return skill;
  }, [events]);

  const planSteps = useMemo<PlanStep[]>(() => {
    let steps: PlanStep[] = [];

    for (const e of events) {
      if (e.type === "plan_created") {
        const rawSteps = e.data.steps as Array<{ name: string; description: string }> | undefined;
        if (Array.isArray(rawSteps)) {
          steps = rawSteps.map((s) => ({
            name: String(s.name ?? ""),
            description: String(s.description ?? ""),
            status: "pending" as const,
          }));
        }
      }

      if (e.type === "agent_spawn") {
        const agentName = String(e.data.name ?? "");
        const agentId = String(e.data.agent_id ?? e.data.id ?? "");
        // Match spawned agent to a plan step by name
        const matchIdx = steps.findIndex(
          (s) => s.status === "pending" && s.name === agentName,
        );
        if (matchIdx !== -1) {
          steps = steps.map((s, i) =>
            i === matchIdx ? { ...s, status: "running" as const, agentId } : s,
          );
        }
      }

      if (e.type === "agent_complete") {
        const agentId = String(e.data.agent_id ?? e.data.id ?? "");
        const hasError = Boolean(e.data.error);
        steps = steps.map((s) =>
          s.agentId === agentId
            ? { ...s, status: hasError ? "error" as const : "complete" as const }
            : s,
        );
      }
    }

    return steps;
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
    planSteps,
    currentIteration,
    reasoningSteps,
    thinkingContent,
    isStreaming,
    assistantPhase,
    artifacts,
    activeSkill,
  };
}
