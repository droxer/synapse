"use client";

import { useMemo, useRef } from "react";

// Some models embed chain-of-thought in the assistant text using `<redacted_thinking>…</redacted_thinking>`
// (see `agent/llm/client._split_think_tags`) or legacy `<redacted_thinking>…</think>` pairs.
// Strip every block so reasoning appears in ThinkingBlock, not in the markdown body.
const INLINE_THINK_PATTERNS = [
  /<redacted_thinking>([\s\S]*?)<\/redacted_thinking>/gi,
  /<redacted_thinking>([\s\S]*?)<\/think>/gi,
];

function splitThinkTag(text: string): { thinking: string; content: string } {
  const thinkingParts: string[] = [];
  let clean = text;
  for (const re of INLINE_THINK_PATTERNS) {
    clean = clean.replace(re, (_match, inner: string) => {
      const trimmed = inner.trim();
      if (trimmed) thinkingParts.push(trimmed);
      return "";
    });
  }
  return { thinking: thinkingParts.join("\n\n"), content: clean.trim() };
}

import type {
  AgentEvent,
  ArtifactInfo,
  AgentStatusState,
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

function mapAgentTerminalStatus(value: unknown): AgentStatusState {
  switch (value) {
    case "complete":
    case "skipped":
    case "replan_required":
    case "error":
      return value;
    default:
      return "error";
  }
}

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

function normalizeComparableMessageContent(content: string): string {
  return content.trim();
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
  const streamableCodeTools = new Set(["code_run", "code_interpret", "shell_exec"]);
  const skillToolNames = new Set(["activate_skill", "load_skill"]);

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

  const resolveActiveStreamRow = (): string | undefined => {
    for (let i = toolCallOrder.length - 1; i >= 0; i--) {
      const rowId = toolCallOrder[i]!;
      const call = toolCallMap.get(rowId);
      if (call && streamableCodeTools.has(call.name) && call.success === undefined) {
        return rowId;
      }
    }
    return undefined;
  };

  const resolveSkillRow = (skillName: string): string | undefined => {
    for (let i = toolCallOrder.length - 1; i >= 0; i--) {
      const rowId = toolCallOrder[i]!;
      const call = toolCallMap.get(rowId);
      if (!call) continue;
      if (
        skillToolNames.has(call.name)
        && String(call.input.name ?? "") === skillName
      ) {
        return rowId;
      }
      if (call.name === "activate_skill" && call.toolUseId.startsWith("skill-event:") && String(call.input.name ?? "") === skillName) {
        return rowId;
      }
    }
    return undefined;
  };

  const ensureSkillRow = (
    skillName: string,
    timestamp: number,
    source?: string,
  ): string => {
    const existingId = resolveSkillRow(skillName);
    if (existingId) return existingId;

    const rowId = `tc-${++toolCallSeq}`;
    const toolUseId = `skill-event:${skillName}:${source ?? "unknown"}:${timestamp}`;
    toolCallOrder.push(rowId);
    toolCallMap.set(rowId, {
      id: rowId,
      toolUseId,
      name: "activate_skill",
      input: { name: skillName, source },
      timestamp,
    });
    return rowId;
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
      const stopReason =
        typeof event.data.stop_reason === "string" ? event.data.stop_reason : "";
      const isTerminalEndTurn = stopReason === "end_turn";
      if (responseText.length > 0) {
        reasoningSteps.push(responseText);
      }

      const rawText = responseText;
      if (rawText && !isTerminalEndTurn) {
        const { thinking: inlineThinking, content } = splitThinkTag(rawText);
        const allThinking = [...pendingThinkingParts, ...(inlineThinking ? [inlineThinking] : [])];
        const thinkingContent = allThinking.length > 0 ? allThinking.join("\n\n") : undefined;
        let message: ChatMessage = {
          role: "assistant",
          content,
          // Use response completion time so ordering matches emit order when
          // streaming started long before the final llm_response event.
          timestamp: event.timestamp,
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
      const input = (event.data.input ?? event.data.tool_input ?? event.data.arguments ?? {}) as Record<string, unknown>;

      // If this is a skill tool call, reuse any synthetic placeholder row created by
      // an earlier skill_activated event instead of creating a duplicate row.
      let rowId: string | undefined;
      if (skillToolNames.has(toolName)) {
        const skillName = String(input.name ?? "");
        if (skillName) {
          const syntheticId = resolveSkillRow(skillName);
          const synthetic = syntheticId ? toolCallMap.get(syntheticId) : undefined;
          if (syntheticId && synthetic?.toolUseId.startsWith("skill-event:")) {
            rowId = syntheticId;
            toolCallMap.set(rowId, {
              ...synthetic,
              toolUseId,
              name: toolName,
              input,
              timestamp: event.timestamp,
              agentId: event.data.agent_id ? String(event.data.agent_id) : synthetic.agentId,
              thinkingText: pendingToolCallThinking || undefined,
              // Reset success so the row stays pending until tool_result / skill_activated
              success: undefined,
            });
          }
        }
      }

      if (!rowId) {
        rowId = `tc-${++toolCallSeq}`;
        toolCallOrder.push(rowId);
        toolCallMap.set(rowId, {
          id: rowId,
          toolUseId,
          name: toolName,
          input,
          timestamp: event.timestamp,
          agentId: event.data.agent_id ? String(event.data.agent_id) : undefined,
          thinkingText: pendingToolCallThinking || undefined,
        });
      }
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
        const isSkillTool = skillToolNames.has(existing.name);
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
          // Skill tools: keep "pending" on success until skill_activated / staging, but surface
          // hard failures from tool_result (unknown skill, etc.) so the UI is not stuck loading.
          success: isSkillTool
            ? event.data.success === false
              ? false
              : existing.success
            : event.data.success !== false,
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
    } else if (event.type === "skill_activated") {
      const skillName = String(event.data.name ?? "");
      if (skillName) {
        const rowId = ensureSkillRow(skillName, event.timestamp, event.data.source);
        const existing = toolCallMap.get(rowId);
        if (existing) {
          toolCallMap.set(rowId, {
            ...existing,
            success: true,
          });
        }
      }
    } else if (event.type === "skill_setup_failed") {
      const skillName = String(event.data.name ?? "");
      if (skillName) {
        const rowId = ensureSkillRow(skillName, event.timestamp, event.data.source);
        const existing = toolCallMap.get(rowId);
        if (existing) {
          const phase = typeof event.data.phase === "string" ? event.data.phase : "setup";
          const manager = typeof event.data.manager === "string" ? ` (${event.data.manager})` : "";
          const packages = typeof event.data.packages === "string" && event.data.packages.length > 0
            ? `: ${event.data.packages}`
            : "";
          const detail = typeof event.data.error === "string" ? event.data.error : "Unknown skill setup error";
          toolCallMap.set(rowId, {
            ...existing,
            success: false,
            output: `Skill ${phase} failed${manager}${packages}\n${detail}`,
          });
        }
      }
    } else if (event.type === "sandbox_stdout" || event.type === "sandbox_stderr") {
      const streamRowId = resolveActiveStreamRow();
      const existing = streamRowId ? toolCallMap.get(streamRowId) : undefined;
      const text = typeof event.data.text === "string" ? event.data.text : "";
      if (existing && streamRowId && text.length > 0) {
        const chunk = event.type === "sandbox_stderr" ? `stderr: ${text}` : text;
        toolCallMap.set(streamRowId, {
          ...existing,
          output: `${existing.output ?? ""}${chunk}`,
        });
      }
    } else if (event.type === "code_result") {
      const directToolId = event.data.tool_id ? String(event.data.tool_id) : "";
      let targetId: string | undefined;
      if (directToolId) {
        for (let i = toolCallOrder.length - 1; i >= 0; i--) {
          const rowId = toolCallOrder[i]!;
          const call = toolCallMap.get(rowId);
          if (call && call.toolUseId === directToolId && streamableCodeTools.has(call.name) && call.output === undefined) {
            targetId = rowId;
            break;
          }
        }
      }
      if (!targetId) {
        targetId = resolveActiveStreamRow();
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
      if (event.type === "task_complete") {
        planSteps = planSteps.map((step) =>
          step.executionType === "planner_owned" && step.status !== "complete"
            ? { ...step, status: "complete" }
            : step,
        );
      }
      const rawResult = String(event.data.result ?? "");
      if (rawResult) {
        const { thinking: inlineThinking, content } = splitThinkTag(rawResult);
        const normalizedContent = normalizeComparableMessageContent(content);
        const alreadyShown = messages.some(
          (message) =>
            message.role === "assistant"
            && normalizeComparableMessageContent(message.content) === normalizedContent,
        );
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
            const existingIdx = messages.findLastIndex(
              (message) =>
                message.role === "assistant"
                && normalizeComparableMessageContent(message.content) === normalizedContent,
            );
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
            const existingIdx = messages.findLastIndex(
              (message) =>
                message.role === "assistant"
                && normalizeComparableMessageContent(message.content) === normalizedContent,
            );
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
      const filePath =
        typeof event.data.file_path === "string" && event.data.file_path.trim() !== ""
          ? event.data.file_path
          : undefined;
      artifacts.push({
        id: artifactId,
        name: String(event.data.name ?? ""),
        contentType,
        size: Number(event.data.size ?? 0),
        createdAt: new Date(event.timestamp).toISOString(),
        ...(filePath !== undefined ? { filePath } : {}),
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
      const pendingStepIdx = planSteps.findIndex(
        (step) =>
          step.status === "pending"
          && step.executionType !== "planner_owned"
          && step.name.trim().toLowerCase() === normalizedName,
      );
      if (pendingStepIdx !== -1) {
        planSteps = planSteps.map((step, idx) => idx === pendingStepIdx ? { ...step, status: "running", agentId } : step);
      }
    } else if (event.type === "agent_start") {
      const agentId = String(event.data.agent_id ?? event.data.id ?? "");
      const existing = agentMap.get(agentId);
      if (existing) {
        agentMap.set(agentId, {
          ...existing,
          status: "running",
        });
      }
    } else if (event.type === "agent_complete") {
      const agentId = String(event.data.agent_id ?? event.data.id ?? "");
      const existing = agentMap.get(agentId);
      const terminalState = mapAgentTerminalStatus(event.data.terminal_state);
      const nextStatus = terminalState;
      if (existing) {
        agentMap.set(agentId, {
          ...existing,
          status: nextStatus,
        });
      }
      planSteps = planSteps.map((step) =>
        step.agentId === agentId
          ? { ...step, status: nextStatus === "complete" ? "complete" : "error" }
          : step,
      );
      if (nextStatus === "complete") {
        planSteps = planSteps.map((step) =>
          step.executionType === "planner_owned" && step.status !== "complete"
            ? { ...step, status: "complete" }
            : step,
        );
      }
    } else if (event.type === "agent_skipped" || event.type === "agent_replan_required") {
      const agentId = String(event.data.agent_id ?? event.data.id ?? "");
      const existing = agentMap.get(agentId);
      if (existing) {
        agentMap.set(agentId, {
          ...existing,
          status: event.type === "agent_skipped" ? "skipped" : "replan_required",
        });
      }
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
    } else if (event.type === "agent_stage_transition") {
      const agentId = String(event.data.agent_id ?? event.data.id ?? "");
      const existing = agentMap.get(agentId);
      if (existing) {
        const targetRole = String(event.data.to_role ?? "");
        const reason = String(event.data.reason ?? "");
        const transitionDescription = reason
          ? `Handed off to ${targetRole}: ${reason}`
          : `Handed off to ${targetRole}`;
        agentMap.set(agentId, {
          ...existing,
          description: `${existing.description} → ${transitionDescription}`,
          status: "running",
        });
      }
    } else if (event.type === "plan_created") {
      if (Array.isArray(event.data.steps)) {
        planSteps = event.data.steps.map((step) => ({
          name: String(step.name ?? ""),
          description: String(step.description ?? ""),
          executionType:
            step.execution_type === "planner_owned"
            || step.execution_type === "sequential_worker"
            || step.execution_type === "parallel_worker"
              ? step.execution_type
              : "parallel_worker",
          status: step.execution_type === "planner_owned" ? "running" : "pending",
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

// ── Structural sharing ──────────────────────────────────────────────
// After deriving new state, reuse previous array/object references when
// the content hasn't meaningfully changed.  This prevents downstream
// useMemo / React.memo invalidation from cascading unnecessarily.

function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function messagesEqual(a: readonly ChatMessage[], b: readonly ChatMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const am = a[i];
    const bm = b[i];
    if (
      am.role !== bm.role ||
      am.content !== bm.content ||
      am.timestamp !== bm.timestamp ||
      am.thinkingContent !== bm.thinkingContent ||
      am.thinkingEntries !== bm.thinkingEntries ||
      am.imageArtifactIds !== bm.imageArtifactIds
    ) {
      return false;
    }
  }
  return true;
}

function toolCallsEqual(a: readonly ToolCallInfo[], b: readonly ToolCallInfo[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const at = a[i];
    const bt = b[i];
    if (
      at.id !== bt.id ||
      at.output !== bt.output ||
      at.success !== bt.success ||
      at.name !== bt.name
    ) {
      return false;
    }
  }
  return true;
}

function planStepsEqual(a: readonly PlanStep[], b: readonly PlanStep[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].status !== b[i].status) return false;
  }
  return true;
}

export function useAgentState(events: AgentEvent[]) {
  const prevRef = useRef<DerivedAgentState | null>(null);

  return useMemo(() => {
    const next = deriveAgentState(events);
    const prev = prevRef.current;

    if (prev) {
      // Reuse previous references for arrays that haven't changed,
      // so downstream useMemo dependencies stay stable.
      const stable: DerivedAgentState = {
        messages: messagesEqual(prev.messages, next.messages) ? prev.messages : next.messages,
        toolCalls: toolCallsEqual(prev.toolCalls, next.toolCalls) ? prev.toolCalls : next.toolCalls,
        taskState: next.taskState,
        agentStatuses: shallowArrayEqual(prev.agentStatuses, next.agentStatuses) ? prev.agentStatuses : next.agentStatuses,
        planSteps: planStepsEqual(prev.planSteps, next.planSteps) ? prev.planSteps : next.planSteps,
        currentIteration: next.currentIteration,
        reasoningSteps: shallowArrayEqual(prev.reasoningSteps, next.reasoningSteps) ? prev.reasoningSteps : next.reasoningSteps,
        thinkingContent: next.thinkingContent,
        thinkingDurationMs: next.thinkingDurationMs,
        currentThinkingEntries: shallowArrayEqual(prev.currentThinkingEntries, next.currentThinkingEntries)
          ? prev.currentThinkingEntries
          : next.currentThinkingEntries,
        isStreaming: next.isStreaming,
        assistantPhase:
          prev.assistantPhase.phase === next.assistantPhase.phase &&
          (prev.assistantPhase as Record<string, unknown>).toolName === (next.assistantPhase as Record<string, unknown>).toolName
            ? prev.assistantPhase
            : next.assistantPhase,
        artifacts: shallowArrayEqual(prev.artifacts, next.artifacts) ? prev.artifacts : next.artifacts,
      };
      prevRef.current = stable;
      return stable;
    }

    prevRef.current = next;
    return next;
  }, [events]);
}
