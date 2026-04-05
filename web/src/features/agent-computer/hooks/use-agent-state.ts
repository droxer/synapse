"use client";

import { useMemo } from "react";

// Some LLM providers (e.g. Qwen3 via DashScope) embed thinking content in
// the response text using <think>…</think> tags rather than returning it as
// a separate content block.  Split them out so we can display the reasoning
// in a dedicated ThinkingBlock instead of raw prose.
const THINK_TAG_RE = /^<think>([\s\S]*?)<\/think>\s*/;

function splitThinkTag(text: string): { thinking: string; content: string } {
  const m = THINK_TAG_RE.exec(text);
  if (!m) return { thinking: "", content: text };
  return { thinking: m[1].trim(), content: text.slice(m[0].length) };
}

import type {
  AgentEvent,
  ArtifactInfo,
  AssistantPhase,
  BrowserMetadata,
  ComputerUseMetadata,
  ChatMessage,
  ThinkingEntry,
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
    let pendingThinkingEntries: ThinkingEntry[] = [];
    // Track which artifact IDs are images
    const imageArtifactIdSet = new Set<string>();
    // Accumulate thinking content between messages
    let pendingThinkingParts: string[] = [];

    const appendPendingThinkingToMessage = (msg: ChatMessage): ChatMessage => {
      if (pendingThinkingEntries.length === 0) return msg;
      const withThinking: ChatMessage = {
        ...msg,
        thinkingEntries: pendingThinkingEntries,
      };
      pendingThinkingEntries = [];
      return withThinking;
    };

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
        const newImageIds = artifactIds.filter((aid) => imageArtifactIdSet.has(aid));
        if (newImageIds.length > 0) {
          pendingImageArtifactIds = [...pendingImageArtifactIds, ...newImageIds];
        }
      }

      if (e.type === "thinking") {
        const text = String(e.data.thinking ?? e.data.text ?? e.data.content ?? "");
        if (text) {
          pendingThinkingParts = [...pendingThinkingParts, text];
          pendingThinkingEntries = [
            ...pendingThinkingEntries,
            {
              content: text,
              timestamp: e.timestamp,
              durationMs:
                typeof e.data.duration_ms === "number" && Number.isFinite(e.data.duration_ms)
                  ? e.data.duration_ms
                  : 0,
            },
          ];
        }
      } else if (e.type === "turn_start") {
        pendingThinkingEntries = [];
        const userMsg = String(e.data.message ?? "");
        if (userMsg) {
          msgs.push({ role: "user", content: userMsg, timestamp: e.timestamp });
        }
        // Reset thinking accumulator at turn start
        pendingThinkingParts = [];
      } else if (e.type === "text_delta") {
        // Accumulate streaming text from deltas
        streamingText += String(e.data.delta ?? "");
        if (streamingTimestamp === 0) {
          streamingTimestamp = e.timestamp;
        }
      } else if (e.type === "llm_response") {
        // LLM response finalizes the streamed text
        const rawText = String(e.data.text ?? "");
        // Reset streaming buffer — this response covers the accumulated deltas (values read on later events)
        // eslint-disable-next-line no-useless-assignment -- loop-carried streaming state
        streamingText = "";
        // eslint-disable-next-line no-useless-assignment -- loop-carried streaming state
        streamingTimestamp = 0;
        if (rawText) {
          // Strip inline <think> tags (used by Qwen3 and similar models when
          // thinking is embedded in the text block rather than a separate block).
          const { thinking: inlineThinking, content: text } = splitThinkTag(rawText);
          const allThinking = [...pendingThinkingParts, ...(inlineThinking ? [inlineThinking] : [])];
          const thinkingContent = allThinking.length > 0 ? allThinking.join("\n\n") : undefined;
          let msg: ChatMessage = {
            role: "assistant",
            content: text,
            timestamp: e.timestamp,
            ...(thinkingContent && { thinkingContent }),
            ...(pendingImageArtifactIds.length > 0 && { imageArtifactIds: pendingImageArtifactIds }),
          };
          msg = appendPendingThinkingToMessage(msg);
          if (pendingImageArtifactIds.length > 0) {
            pendingImageArtifactIds = [];
          }
          pendingThinkingParts = [];
          msgs.push(msg);
        }
        streamingText = "";
        streamingTimestamp = 0;
      } else if (e.type === "message_user") {
        const thinkingContent = pendingThinkingParts.length > 0
          ? pendingThinkingParts.join("\n\n")
          : undefined;
        let msg: ChatMessage = {
          role: "assistant",
          content: String(e.data.message ?? e.data.content ?? ""),
          timestamp: e.timestamp,
          ...(thinkingContent && { thinkingContent }),
          ...(pendingImageArtifactIds.length > 0 && { imageArtifactIds: pendingImageArtifactIds }),
        };
        msg = appendPendingThinkingToMessage(msg);
        if (pendingImageArtifactIds.length > 0) {
          pendingImageArtifactIds = [];
        }
        pendingThinkingParts = [];
        msgs.push(msg);
      } else if (e.type === "turn_cancelled") {
        // Finalize any streaming text as a partial message
        if (streamingText) {
          const thinkingContent = pendingThinkingParts.length > 0
            ? pendingThinkingParts.join("\n\n")
            : undefined;
          let msg: ChatMessage = {
            role: "assistant",
            content: streamingText,
            timestamp: streamingTimestamp,
            ...(thinkingContent && { thinkingContent }),
            ...(pendingImageArtifactIds.length > 0 && { imageArtifactIds: pendingImageArtifactIds }),
          };
          msg = appendPendingThinkingToMessage(msg);
          if (pendingImageArtifactIds.length > 0) {
            pendingImageArtifactIds = [];
          }
          pendingThinkingParts = [];
          msgs.push(msg);
          streamingText = "";
          streamingTimestamp = 0;
        }
      } else if (e.type === "turn_complete" || e.type === "task_complete") {
        const rawResult = String(e.data.result ?? "");
        if (rawResult) {
          const { thinking: inlineThinking, content: result } = splitThinkTag(rawResult);
          const alreadyShown = msgs.some(
            (m) => m.role === "assistant" && m.content === result,
          );
          if (!alreadyShown) {
            const allThinking = [...pendingThinkingParts, ...(inlineThinking ? [inlineThinking] : [])];
            const thinkingContent = allThinking.length > 0 ? allThinking.join("\n\n") : undefined;
            const msg: ChatMessage = {
              role: "assistant",
              content: result,
              timestamp: e.timestamp,
              ...(thinkingContent && { thinkingContent }),
              ...(pendingImageArtifactIds.length > 0 && { imageArtifactIds: pendingImageArtifactIds }),
            };
            const withThinking = appendPendingThinkingToMessage(msg);
            if (pendingImageArtifactIds.length > 0) {
              pendingImageArtifactIds = [];
            }
            pendingThinkingParts = [];
            msgs.push(withThinking);
          } else if (pendingImageArtifactIds.length > 0) {
            // Attach to the existing matching message (immutably replace in array)
            const existingIdx = msgs.findLastIndex(
              (m) => m.role === "assistant" && m.content === result,
            );
            if (existingIdx !== -1) {
              const existing = msgs[existingIdx];
              msgs[existingIdx] = {
                ...existing,
                imageArtifactIds: [
                  ...(existing.imageArtifactIds ?? []),
                  ...pendingImageArtifactIds,
                ],
              };
            }
            pendingImageArtifactIds = [];
          }
          if (pendingThinkingEntries.length > 0) {
            const existingIdx = msgs.findLastIndex(
              (m) => m.role === "assistant" && m.content === result,
            );
            if (existingIdx !== -1) {
              const existing = msgs[existingIdx];
              msgs[existingIdx] = {
                ...existing,
                thinkingEntries: [
                  ...(existing.thinkingEntries ?? []),
                  ...pendingThinkingEntries,
                ],
              };
              pendingThinkingEntries = [];
            }
          }
        } else if (pendingImageArtifactIds.length > 0) {
          // No result text but have pending images — attach to last assistant message (immutably replace in array)
          const lastIdx = msgs.findLastIndex((m) => m.role === "assistant");
          if (lastIdx !== -1) {
            const lastAssistant = msgs[lastIdx];
            msgs[lastIdx] = {
              ...lastAssistant,
              imageArtifactIds: [
                ...(lastAssistant.imageArtifactIds ?? []),
                ...pendingImageArtifactIds,
              ],
            };
          }
          pendingImageArtifactIds = [];
        }
        if (pendingThinkingEntries.length > 0) {
          const lastIdx = msgs.findLastIndex((m) => m.role === "assistant");
          if (lastIdx !== -1) {
            const lastAssistant = msgs[lastIdx];
            msgs[lastIdx] = {
              ...lastAssistant,
              thinkingEntries: [
                ...(lastAssistant.thinkingEntries ?? []),
                ...pendingThinkingEntries,
              ],
            };
            pendingThinkingEntries = [];
          }
        }
      } else if (e.type === "task_error") {
        const error = String(e.data.error ?? "An error occurred");
        const msg: ChatMessage = appendPendingThinkingToMessage({
          role: "assistant",
          content: `Error: ${error}`,
          timestamp: e.timestamp,
        });
        msgs.push(msg);
        pendingImageArtifactIds = [];
      }
    }

    // If there's still streaming text (deltas arrived but no llm_response yet),
    // show it as an in-progress message
    if (streamingText) {
      const thinkingContent = pendingThinkingParts.length > 0
        ? pendingThinkingParts.join("\n\n")
        : undefined;
      let msg: ChatMessage = {
        role: "assistant",
        content: streamingText,
        timestamp: streamingTimestamp,
        ...(thinkingContent && { thinkingContent }),
        ...(pendingImageArtifactIds.length > 0 && { imageArtifactIds: pendingImageArtifactIds }),
      };
      msg = appendPendingThinkingToMessage(msg);
      if (pendingImageArtifactIds.length > 0) {
        pendingImageArtifactIds = [];
      }
      msgs.push(msg);
    }

    // If there are still pending image artifacts, attach to last assistant message
    if (pendingImageArtifactIds.length > 0) {
      const lastIdx = msgs.findLastIndex((m) => m.role === "assistant");
      if (lastIdx !== -1) {
        const lastAssistant = msgs[lastIdx];
        msgs[lastIdx] = {
          ...lastAssistant,
          imageArtifactIds: [
            ...(lastAssistant.imageArtifactIds ?? []),
            ...pendingImageArtifactIds,
          ],
        };
      }
    }
    if (pendingThinkingEntries.length > 0) {
      const lastIdx = msgs.findLastIndex((m) => m.role === "assistant");
      if (lastIdx !== -1) {
        const lastAssistant = msgs[lastIdx];
        msgs[lastIdx] = {
          ...lastAssistant,
          thinkingEntries: [
            ...(lastAssistant.thinkingEntries ?? []),
            ...pendingThinkingEntries,
          ],
        };
      }
    }

    // If THINKING events arrived after LLM_RESPONSE (old DB ordering), attach
    // leftover thinking to the last assistant message that has no thinking yet.
    if (pendingThinkingParts.length > 0) {
      const lastIdx = msgs.findLastIndex((m) => m.role === "assistant");
      if (lastIdx !== -1 && !msgs[lastIdx].thinkingContent) {
        msgs[lastIdx] = {
          ...msgs[lastIdx],
          thinkingContent: pendingThinkingParts.join("\n\n"),
        };
      }
    }

    return msgs;
  }, [events]);

  const toolCalls = useMemo<ToolCallInfo[]>(() => {
    const callMap = new Map<string, ToolCallInfo>();
    const insertOrder: string[] = [];
    let pendingThinking = "";
    let toolCallSeq = 0;

    const resolveToolResultRow = (apiToolId: string): string | undefined => {
      if (!apiToolId) return undefined;
      for (let i = insertOrder.length - 1; i >= 0; i--) {
        const rid = insertOrder[i]!;
        const call = callMap.get(rid);
        if (call && call.toolUseId === apiToolId && call.output === undefined) {
          return rid;
        }
      }
      for (let i = insertOrder.length - 1; i >= 0; i--) {
        const rid = insertOrder[i]!;
        const call = callMap.get(rid);
        if (call && call.toolUseId === apiToolId) {
          return rid;
        }
      }
      return undefined;
    };

    for (const e of events) {
      if (e.type === "thinking") {
        pendingThinking = String(e.data.thinking ?? e.data.text ?? e.data.content ?? "");
      }

      if (e.type === "tool_call") {
        const rawApiId = e.data.tool_id ?? e.data.id;
        const toolUseId =
          rawApiId != null && String(rawApiId).length > 0
            ? String(rawApiId)
            : crypto.randomUUID();
        const rowId = `tc-${++toolCallSeq}`;
        const agentId = e.data.agent_id ? String(e.data.agent_id) : undefined;
        const entry: ToolCallInfo = {
          id: rowId,
          toolUseId,
          name: String(e.data.name ?? e.data.tool_name ?? "unknown"),
          input: (e.data.input ?? e.data.tool_input ?? e.data.arguments ?? {}) as Record<string, unknown>,
          timestamp: e.timestamp,
          agentId,
          thinkingText: pendingThinking || undefined,
        };
        callMap.set(rowId, entry);
        insertOrder.push(rowId);
        pendingThinking = "";
      }
      if (e.type === "tool_result") {
        const apiToolId = String(e.data.tool_id ?? e.data.id ?? "");
        const rowId = resolveToolResultRow(apiToolId);
        const existing = rowId ? callMap.get(rowId) : undefined;
        if (existing) {
          const agentId = e.data.agent_id ? String(e.data.agent_id) : existing.agentId;
          const browserMeta: BrowserMetadata | undefined = existing.name === "browser_use" ? {
            // Merge with existing metadata so streaming partial updates don't wipe previously set fields
            ...existing.browserMetadata,
            ...(typeof e.data.steps === "number" && { steps: e.data.steps }),
            ...(typeof e.data.is_done === "boolean" && { isDone: e.data.is_done }),
            ...(typeof e.data.max_steps === "number" && { maxSteps: e.data.max_steps }),
            ...(typeof e.data.url === "string" && { url: e.data.url }),
            ...(typeof e.data.task === "string" && { task: e.data.task }),
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
          callMap.set(rowId!, {
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
        const codeToolNames = new Set(["code_run", "code_interpret", "shell_exec"]);
        const directId = e.data.tool_id ? String(e.data.tool_id) : undefined;
        let targetId: string | undefined;
        if (directId) {
          for (let i = insertOrder.length - 1; i >= 0; i--) {
            const id = insertOrder[i]!;
            const call = callMap.get(id);
            if (
              call
              && call.toolUseId === directId
              && codeToolNames.has(call.name)
              && call.output === undefined
            ) {
              targetId = id;
              break;
            }
          }
        }
        if (!targetId) {
          // Fall back: most recent code tool call with no output yet
          for (let i = insertOrder.length - 1; i >= 0; i--) {
            const id = insertOrder[i]!;
            const call = callMap.get(id);
            if (call && codeToolNames.has(call.name) && call.output === undefined) {
              targetId = id;
              break;
            }
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
      .map((e) => String(e.data.thinking ?? e.data.text ?? e.data.content ?? ""))
      .join("\n");
  }, [events]);

  const thinkingDurationMs = useMemo<number>(() => {
    const thinkingEvents = events.filter((e) => e.type === "thinking");
    if (thinkingEvents.length === 0) return 0;
    const first = thinkingEvents[0].timestamp;
    const last = thinkingEvents[thinkingEvents.length - 1].timestamp;
    return Math.max(last - first, 0);
  }, [events]);

  const currentThinkingEntries = useMemo<ThinkingEntry[]>(() => {
    let current: ThinkingEntry[] = [];
    for (const e of events) {
      if (e.type === "turn_start") {
        current = [];
      } else if (e.type === "thinking") {
        const content = String(e.data.thinking ?? e.data.text ?? e.data.content ?? "");
        if (content) {
          current = [
            ...current,
            {
              content,
              timestamp: e.timestamp,
              durationMs:
                typeof e.data.duration_ms === "number" && Number.isFinite(e.data.duration_ms)
                  ? e.data.duration_ms
                  : 0,
            },
          ];
        }
      } else if (
        e.type === "turn_complete" ||
        e.type === "turn_cancelled" ||
        e.type === "task_complete" ||
        e.type === "task_error"
      ) {
        current = [];
      }
    }
    return current;
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
        // Match spawned agent to a plan step by name (case-insensitive, trimmed)
        // to tolerate minor LLM capitalization/whitespace inconsistencies.
        const normalizedAgentName = agentName.trim().toLowerCase();
        const matchIdx = steps.findIndex(
          (s) =>
            s.status === "pending" &&
            s.name.trim().toLowerCase() === normalizedAgentName,
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
    thinkingDurationMs,
    currentThinkingEntries,
    isStreaming,
    assistantPhase,
    artifacts,
  };
}
