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

interface DerivedAgentState {
  readonly messages: ChatMessage[];
  readonly toolCalls: ToolCallInfo[];
  readonly taskState: TaskState;
  readonly agentStatuses: AgentStatus[];
  readonly planSteps: PlanStep[];
  readonly currentIteration: number;
  readonly reasoningSteps: string[];
  readonly thinkingContent: string;
  readonly thinkingDurationMs: number;
  readonly currentThinkingEntries: ThinkingEntry[];
  readonly isStreaming: boolean;
  readonly assistantPhase: AssistantPhase;
  readonly artifacts: ArtifactInfo[];
}

function toThinkingEntry(event: AgentEvent): ThinkingEntry | null {
  if (event.type !== "thinking") return null;
  const content = String(event.data.thinking ?? event.data.text ?? event.data.content ?? "");
  if (!content) return null;
  return {
    content,
    timestamp: event.timestamp,
    durationMs:
      typeof event.data.duration_ms === "number" && Number.isFinite(event.data.duration_ms)
        ? event.data.duration_ms
        : 0,
  };
}

function appendUnique<T>(source: readonly T[] | undefined, additions: readonly T[]): T[] {
  if (!source || source.length === 0) return [...additions];
  return [...source, ...additions];
}

function toDisplayText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function deriveAgentState(events: readonly AgentEvent[]): DerivedAgentState {
  const messages: ChatMessage[] = [];
  const artifacts: ArtifactInfo[] = [];
  const reasoningSteps: string[] = [];
  const toolCallMap = new Map<string, ToolCallInfo>();
  const toolCallOrder: string[] = [];
  const agentMap = new Map<string, AgentStatus>();

  let taskState: TaskState = "idle";
  let currentIteration = 0;
  let isStreaming = false;
  let assistantPhase: AssistantPhase = { phase: "idle" };
  const pendingToolIds = new Set<string>();

  let streamingText = "";
  let streamingTimestamp = 0;
  const imageArtifactIdSet = new Set<string>();
  let pendingImageArtifactIds: string[] = [];
  let pendingThinkingParts: string[] = [];
  let pendingThinkingEntries: ThinkingEntry[] = [];
  let currentThinkingEntries: ThinkingEntry[] = [];
  const allThinkingEntries: ThinkingEntry[] = [];
  let pendingToolCallThinking = "";
  let toolCallSeq = 0;
  let planSteps: PlanStep[] = [];

  const resolveToolResultRow = (apiToolId: string): string | undefined => {
    if (!apiToolId) return undefined;
    for (let i = toolCallOrder.length - 1; i >= 0; i--) {
      const rowId = toolCallOrder[i]!;
      const call = toolCallMap.get(rowId);
      if (call && call.toolUseId === apiToolId && call.output === undefined) {
        return rowId;
      }
    }
    for (let i = toolCallOrder.length - 1; i >= 0; i--) {
      const rowId = toolCallOrder[i]!;
      const call = toolCallMap.get(rowId);
      if (call && call.toolUseId === apiToolId) {
        return rowId;
      }
    }
    return undefined;
  };

  const attachPendingThinking = (message: ChatMessage): ChatMessage => {
    if (pendingThinkingEntries.length === 0) return message;
    const withThinking: ChatMessage = {
      ...message,
      thinkingEntries: pendingThinkingEntries,
    };
    pendingThinkingEntries = [];
    return withThinking;
  };

  const attachPendingArtifactsToLastAssistant = () => {
    if (pendingImageArtifactIds.length === 0) return;
    const lastAssistantIdx = messages.findLastIndex((msg) => msg.role === "assistant");
    if (lastAssistantIdx === -1) return;
    const existing = messages[lastAssistantIdx]!;
    messages[lastAssistantIdx] = {
      ...existing,
      imageArtifactIds: appendUnique(existing.imageArtifactIds, pendingImageArtifactIds),
    };
    pendingImageArtifactIds = [];
  };

  const attachPendingThinkingToLastAssistant = () => {
    if (pendingThinkingEntries.length === 0) return;
    const lastAssistantIdx = messages.findLastIndex((msg) => msg.role === "assistant");
    if (lastAssistantIdx === -1) return;
    const existing = messages[lastAssistantIdx]!;
    messages[lastAssistantIdx] = {
      ...existing,
      thinkingEntries: appendUnique(existing.thinkingEntries, pendingThinkingEntries),
    };
    pendingThinkingEntries = [];
  };

  for (const event of events) {
    if (event.iteration !== null && event.iteration > currentIteration) {
      currentIteration = event.iteration;
    }

    if (event.type === "turn_start" || event.type === "task_start" || event.type === "iteration_start" || event.type === "tool_call") {
      taskState = "executing";
    } else if (event.type === "agent_spawn") {
      taskState = "planning";
    } else if (event.type === "turn_complete" || event.type === "turn_cancelled") {
      taskState = "idle";
    } else if (event.type === "task_complete") {
      taskState = "complete";
    } else if (event.type === "task_error") {
      taskState = "error";
    }

    if (event.type === "thinking") {
      assistantPhase = { phase: "thinking" };
      const thinkingEntry = toThinkingEntry(event);
      if (thinkingEntry) {
        allThinkingEntries.push(thinkingEntry);
        currentThinkingEntries = [...currentThinkingEntries, thinkingEntry];
        pendingThinkingEntries = [...pendingThinkingEntries, thinkingEntry];
        pendingThinkingParts = [...pendingThinkingParts, thinkingEntry.content];
        pendingToolCallThinking = thinkingEntry.content;
      }
    } else if (event.type === "text_delta") {
      assistantPhase = { phase: "writing" };
      isStreaming = true;
      streamingText += String(event.data.delta ?? "");
      if (streamingTimestamp === 0) {
        streamingTimestamp = event.timestamp;
      }
    } else if (event.type === "llm_response") {
      assistantPhase = { phase: "idle" };
      isStreaming = false;
      const responseText = toDisplayText(event.data.text ?? event.data.content ?? event.data.message);
      if (responseText.length > 0) {
        reasoningSteps.push(responseText);
      }

      const rawText = responseText;
      if (rawText) {
        const { thinking: inlineThinking, content } = splitThinkTag(rawText);
        const allThinking = [...pendingThinkingParts, ...(inlineThinking ? [inlineThinking] : [])];
        const thinkingContent = allThinking.length > 0 ? allThinking.join("\n\n") : undefined;
        let message: ChatMessage = {
          role: "assistant",
          content,
          timestamp: streamingTimestamp > 0 ? streamingTimestamp : event.timestamp,
          ...(thinkingContent ? { thinkingContent } : {}),
          ...(pendingImageArtifactIds.length > 0 ? { imageArtifactIds: pendingImageArtifactIds } : {}),
        };
        message = attachPendingThinking(message);
        messages.push(message);
        pendingImageArtifactIds = [];
        pendingThinkingParts = [];
      }
      streamingText = "";
      streamingTimestamp = 0;
    } else if (event.type === "tool_call") {
      const toolId = String(event.data.tool_id ?? event.data.id ?? "");
      const toolName = String(event.data.name ?? event.data.tool_name ?? "tool");
      pendingToolIds.add(toolId);
      assistantPhase = { phase: "using_tool", toolName };

      const toolUseId = toolId.length > 0 ? toolId : crypto.randomUUID();
      const rowId = `tc-${++toolCallSeq}`;
      toolCallOrder.push(rowId);
      toolCallMap.set(rowId, {
        id: rowId,
        toolUseId,
        name: String(event.data.name ?? event.data.tool_name ?? "unknown"),
        input: (event.data.input ?? event.data.tool_input ?? event.data.arguments ?? {}) as Record<string, unknown>,
        timestamp: event.timestamp,
        agentId: event.data.agent_id ? String(event.data.agent_id) : undefined,
        thinkingText: pendingToolCallThinking || undefined,
      });
      pendingToolCallThinking = "";
    } else if (event.type === "tool_result") {
      const toolId = String(event.data.tool_id ?? event.data.id ?? "");
      pendingToolIds.delete(toolId);
      if (pendingToolIds.size === 0) {
        assistantPhase = { phase: "idle" };
      }

      const rowId = resolveToolResultRow(toolId);
      const existing = rowId ? toolCallMap.get(rowId) : undefined;
      if (existing && rowId) {
        const browserMetadata: BrowserMetadata | undefined = existing.name === "browser_use"
          ? {
              ...existing.browserMetadata,
              ...(typeof event.data.steps === "number" ? { steps: event.data.steps } : {}),
              ...(typeof event.data.is_done === "boolean" ? { isDone: event.data.is_done } : {}),
              ...(typeof event.data.max_steps === "number" ? { maxSteps: event.data.max_steps } : {}),
              ...(typeof event.data.url === "string" ? { url: event.data.url } : {}),
              ...(typeof event.data.task === "string" ? { task: event.data.task } : {}),
            }
          : undefined;
        const computerUseMetadata: ComputerUseMetadata | undefined =
          existing.name === "computer_action" || existing.name === "computer_screenshot"
            ? {
                action: typeof event.data.action === "string" ? event.data.action : undefined,
                x: typeof event.data.x === "number" ? event.data.x : undefined,
                y: typeof event.data.y === "number" ? event.data.y : undefined,
                text: typeof event.data.text === "string" ? event.data.text : undefined,
                endX: typeof event.data.end_x === "number" ? event.data.end_x : undefined,
                endY: typeof event.data.end_y === "number" ? event.data.end_y : undefined,
                amount: typeof event.data.amount === "number" ? event.data.amount : undefined,
              }
            : undefined;

        toolCallMap.set(rowId, {
          ...existing,
          output: toDisplayText(event.data.output ?? event.data.result),
          success: event.data.success !== false,
          contentType: event.data.content_type ? String(event.data.content_type) : undefined,
          artifactIds: Array.isArray(event.data.artifact_ids) ? event.data.artifact_ids : undefined,
          browserMetadata,
          computerUseMetadata,
          agentId: event.data.agent_id ? String(event.data.agent_id) : existing.agentId,
        });
      }

      const artifactIds = Array.isArray(event.data.artifact_ids) ? event.data.artifact_ids : [];
      const newImageIds = artifactIds.filter((artifactId) => imageArtifactIdSet.has(artifactId));
      if (newImageIds.length > 0) {
        pendingImageArtifactIds = [...pendingImageArtifactIds, ...newImageIds];
      }
    } else if (event.type === "code_result") {
      const codeToolNames = new Set(["code_run", "code_interpret", "shell_exec"]);
      const directToolId = event.data.tool_id ? String(event.data.tool_id) : "";
      let targetId: string | undefined;
      if (directToolId) {
        for (let i = toolCallOrder.length - 1; i >= 0; i--) {
          const rowId = toolCallOrder[i]!;
          const call = toolCallMap.get(rowId);
          if (call && call.toolUseId === directToolId && codeToolNames.has(call.name) && call.output === undefined) {
            targetId = rowId;
            break;
          }
        }
      }
      if (!targetId) {
        for (let i = toolCallOrder.length - 1; i >= 0; i--) {
          const rowId = toolCallOrder[i]!;
          const call = toolCallMap.get(rowId);
          if (call && codeToolNames.has(call.name) && call.output === undefined) {
            targetId = rowId;
            break;
          }
        }
      }
      if (targetId) {
        const existing = toolCallMap.get(targetId);
        if (existing) {
          toolCallMap.set(targetId, {
            ...existing,
            output: toDisplayText(event.data.output ?? event.data.result),
            success: event.data.success !== false,
            contentType: event.data.content_type ? String(event.data.content_type) : "text/plain",
          });
        }
      }
    } else if (event.type === "message_user") {
      const thinkingContent = pendingThinkingParts.length > 0 ? pendingThinkingParts.join("\n\n") : undefined;
      let message: ChatMessage = {
        role: "assistant",
        content: String(event.data.message ?? event.data.content ?? ""),
        timestamp: event.timestamp,
        ...(thinkingContent ? { thinkingContent } : {}),
        ...(pendingImageArtifactIds.length > 0 ? { imageArtifactIds: pendingImageArtifactIds } : {}),
      };
      message = attachPendingThinking(message);
      messages.push(message);
      pendingImageArtifactIds = [];
      pendingThinkingParts = [];
    } else if (event.type === "turn_start") {
      const userText = String(event.data.message ?? "");
      if (userText) {
        messages.push({ role: "user", content: userText, timestamp: event.timestamp });
      }
      planSteps = [];
      pendingThinkingEntries = [];
      pendingThinkingParts = [];
      currentThinkingEntries = [];
    } else if (event.type === "turn_cancelled") {
      isStreaming = false;
      if (streamingText) {
        const thinkingContent = pendingThinkingParts.length > 0 ? pendingThinkingParts.join("\n\n") : undefined;
        let message: ChatMessage = {
          role: "assistant",
          content: streamingText,
          timestamp: streamingTimestamp,
          ...(thinkingContent ? { thinkingContent } : {}),
          ...(pendingImageArtifactIds.length > 0 ? { imageArtifactIds: pendingImageArtifactIds } : {}),
        };
        message = attachPendingThinking(message);
        messages.push(message);
        pendingImageArtifactIds = [];
        pendingThinkingParts = [];
        streamingText = "";
        streamingTimestamp = 0;
      }
      currentThinkingEntries = [];
      assistantPhase = { phase: "idle" };
      pendingToolIds.clear();
    } else if (event.type === "turn_complete" || event.type === "task_complete") {
      isStreaming = false;
      const rawResult = String(event.data.result ?? "");
      if (rawResult) {
        const { thinking: inlineThinking, content } = splitThinkTag(rawResult);
        const alreadyShown = messages.some((message) => message.role === "assistant" && message.content === content);
        if (!alreadyShown) {
          const allThinking = [...pendingThinkingParts, ...(inlineThinking ? [inlineThinking] : [])];
          const thinkingContent = allThinking.length > 0 ? allThinking.join("\n\n") : undefined;
          let message: ChatMessage = {
            role: "assistant",
            content,
            timestamp: event.timestamp,
            ...(thinkingContent ? { thinkingContent } : {}),
            ...(pendingImageArtifactIds.length > 0 ? { imageArtifactIds: pendingImageArtifactIds } : {}),
          };
          message = attachPendingThinking(message);
          messages.push(message);
          pendingImageArtifactIds = [];
          pendingThinkingParts = [];
        } else {
          if (pendingImageArtifactIds.length > 0) {
            const existingIdx = messages.findLastIndex((message) => message.role === "assistant" && message.content === content);
            if (existingIdx !== -1) {
              const existing = messages[existingIdx]!;
              messages[existingIdx] = {
                ...existing,
                imageArtifactIds: appendUnique(existing.imageArtifactIds, pendingImageArtifactIds),
              };
            }
            pendingImageArtifactIds = [];
          }
          if (pendingThinkingEntries.length > 0) {
            const existingIdx = messages.findLastIndex((message) => message.role === "assistant" && message.content === content);
            if (existingIdx !== -1) {
              const existing = messages[existingIdx]!;
              messages[existingIdx] = {
                ...existing,
                thinkingEntries: appendUnique(existing.thinkingEntries, pendingThinkingEntries),
              };
              pendingThinkingEntries = [];
            }
          }
        }
      } else {
        attachPendingArtifactsToLastAssistant();
      }
      attachPendingThinkingToLastAssistant();
      currentThinkingEntries = [];
      assistantPhase = { phase: "idle" };
      pendingToolIds.clear();
    } else if (event.type === "task_error") {
      isStreaming = false;
      const error = String(event.data.error ?? "An error occurred");
      messages.push(
        attachPendingThinking({
          role: "assistant",
          content: `Error: ${error}`,
          timestamp: event.timestamp,
        }),
      );
      pendingImageArtifactIds = [];
      currentThinkingEntries = [];
      assistantPhase = { phase: "idle" };
      pendingToolIds.clear();
    } else if (event.type === "artifact_created") {
      const artifactId = String(event.data.artifact_id ?? crypto.randomUUID());
      const contentType = String(event.data.content_type ?? "application/octet-stream");
      artifacts.push({
        id: artifactId,
        name: String(event.data.name ?? ""),
        contentType,
        size: Number(event.data.size ?? 0),
      });
      if (contentType.startsWith("image/")) {
        imageArtifactIdSet.add(artifactId);
      }
    } else if (event.type === "agent_spawn") {
      const agentId = String(event.data.agent_id ?? event.data.id ?? "");
      const agentName = String(event.data.name ?? "");
      agentMap.set(agentId, {
        agentId,
        name: agentName,
        description: String(event.data.description ?? event.data.task ?? ""),
        status: "running",
        timestamp: event.timestamp,
      });

      const normalizedName = agentName.trim().toLowerCase();
      const pendingStepIdx = planSteps.findIndex((step) => step.status === "pending" && step.name.trim().toLowerCase() === normalizedName);
      if (pendingStepIdx !== -1) {
        planSteps = planSteps.map((step, idx) => idx === pendingStepIdx ? { ...step, status: "running", agentId } : step);
      }
    } else if (event.type === "agent_complete") {
      const agentId = String(event.data.agent_id ?? event.data.id ?? "");
      const existing = agentMap.get(agentId);
      if (existing) {
        agentMap.set(agentId, {
          ...existing,
          status: event.data.error ? "error" : "complete",
        });
      }
      planSteps = planSteps.map((step) =>
        step.agentId === agentId
          ? { ...step, status: event.data.error ? "error" : "complete" }
          : step,
      );
    } else if (event.type === "agent_handoff") {
      const parentId = String(event.data.parent_agent_id ?? "");
      const existing = agentMap.get(parentId);
      if (existing) {
        const targetRole = String(event.data.target_role ?? "");
        const reason = String(event.data.reason ?? "");
        const handoffDescription = reason ? `Handed off to ${targetRole}: ${reason}` : `Handed off to ${targetRole}`;
        agentMap.set(parentId, {
          ...existing,
          description: `${existing.description} → ${handoffDescription}`,
          status: "running",
        });
      }
    } else if (event.type === "plan_created") {
      if (Array.isArray(event.data.steps)) {
        planSteps = event.data.steps.map((step) => ({
          name: String(step.name ?? ""),
          description: String(step.description ?? ""),
          status: "pending",
        }));
      }
    }
  }

  if (streamingText) {
    const thinkingContent = pendingThinkingParts.length > 0 ? pendingThinkingParts.join("\n\n") : undefined;
    let message: ChatMessage = {
      role: "assistant",
      content: streamingText,
      timestamp: streamingTimestamp,
      ...(thinkingContent ? { thinkingContent } : {}),
      ...(pendingImageArtifactIds.length > 0 ? { imageArtifactIds: pendingImageArtifactIds } : {}),
    };
    message = attachPendingThinking(message);
    messages.push(message);
    pendingImageArtifactIds = [];
  }

  attachPendingArtifactsToLastAssistant();
  attachPendingThinkingToLastAssistant();

  if (pendingThinkingParts.length > 0) {
    const lastAssistantIdx = messages.findLastIndex((message) => message.role === "assistant");
    if (lastAssistantIdx !== -1 && !messages[lastAssistantIdx]?.thinkingContent) {
      const existing = messages[lastAssistantIdx]!;
      messages[lastAssistantIdx] = {
        ...existing,
        thinkingContent: pendingThinkingParts.join("\n\n"),
      };
    }
  }

  const toolCalls = toolCallOrder
    .map((id) => toolCallMap.get(id))
    .filter((entry): entry is ToolCallInfo => entry !== undefined);

  return {
    messages,
    toolCalls,
    taskState,
    agentStatuses: Array.from(agentMap.values()),
    planSteps,
    currentIteration,
    reasoningSteps,
    thinkingContent: allThinkingEntries.map((entry) => entry.content).join("\n"),
    thinkingDurationMs:
      allThinkingEntries.length > 0
        ? Math.max(allThinkingEntries[allThinkingEntries.length - 1]!.timestamp - allThinkingEntries[0]!.timestamp, 0)
        : 0,
    currentThinkingEntries,
    isStreaming,
    assistantPhase,
    artifacts,
  };
}

export function useAgentState(events: AgentEvent[]) {
  return useMemo(() => deriveAgentState(events), [events]);
}
