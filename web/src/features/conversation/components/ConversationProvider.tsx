"use client";

import { createContext, useMemo, type ReactNode } from "react";
import { useSSE } from "@/shared/hooks";
import { useAppStore } from "@/shared/stores";
import { useAgentState } from "@/features/agent-computer";
import { useConversation } from "../hooks/use-conversation";
import { useConversationHistory } from "../hooks/use-conversation-history";
import { usePendingAsk } from "../hooks/use-pending-ask";
import type {
  AgentEvent,
  ArtifactInfo,
  AssistantPhase,
  ChatMessage,
  ToolCallInfo,
  TaskState,
  AgentStatus,
  PlanStep,
} from "@/shared/types";

export function getStableDataKey(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => getStableDataKey(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${getStableDataKey(record[key])}`)
    .join(",")}}`;
}

export function getEventKey(event: AgentEvent): string {
  return [
    event.type,
    String(event.timestamp),
    String(event.iteration ?? ""),
    getStableDataKey(event.data),
  ].join("|");
}

export function mergeUniqueEvents(
  historyEvents: readonly AgentEvent[],
  liveEvents: readonly AgentEvent[],
): AgentEvent[] {
  const merged: AgentEvent[] = [];
  const seen = new Set<string>();

  for (const event of [...historyEvents, ...liveEvents]) {
    const key = getEventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }

  return merged;
}

export interface ConversationContextValue {
  readonly conversationId: string | null;
  readonly events: AgentEvent[];
  readonly isConnected: boolean;
  readonly messages: ChatMessage[];
  readonly toolCalls: ToolCallInfo[];
  readonly taskState: TaskState;
  readonly agentStatuses: AgentStatus[];
  readonly planSteps: PlanStep[];
  readonly currentIteration: number;
  readonly reasoningSteps: string[];
  readonly thinkingContent: string;
  readonly isStreaming: boolean;
  readonly assistantPhase: AssistantPhase;
  readonly artifacts: ArtifactInfo[];
  readonly allMessages: ChatMessage[];
  readonly isWaitingForAgent: boolean;
  readonly userCancelled: boolean;
  readonly handleSendMessage: (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => void;
  readonly handleCreateConversation: (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => void;
  readonly handleSwitchConversation: (conversationId: string) => void;
  readonly handleNewConversation: () => void;
  readonly handleCancel: () => void;
  readonly handleRetry: () => void;
  readonly createError: string | null;
  readonly pendingAsk: ReturnType<typeof usePendingAsk>["pendingAsk"];
  readonly handlePromptSubmit: (response: string) => Promise<void>;
  readonly respondError: string | null;
  readonly isLoadingHistory: boolean;
}

export const ConversationContext =
  createContext<ConversationContextValue | null>(null);

interface ConversationProviderProps {
  readonly children: ReactNode;
}

export function ConversationProvider({ children }: ConversationProviderProps) {
  const conversationId = useAppStore((s) => s.conversationId);
  const isLive = useAppStore((s) => s.isLiveConversation);

  const { events, isConnected, clearLastTurn } = useSSE(conversationId, isLive);
  const { historyMessages, historyEvents, isLoading: isLoadingHistory } = useConversationHistory(conversationId);

  // Merge history events with live SSE events so the progress card shows
  // persisted activity even after a page refresh (SSE stream starts empty).
  const effectiveEvents = useMemo(
    () => (isLive ? mergeUniqueEvents(historyEvents, events) : historyEvents),
    [events, historyEvents, isLive],
  );

  const {
    messages,
    toolCalls,
    taskState,
    agentStatuses,
    planSteps,
    currentIteration,
    reasoningSteps,
    thinkingContent,
    isStreaming,
    assistantPhase: rawAssistantPhase,
    artifacts,
  } = useAgentState(effectiveEvents);

  const effectiveTaskState: TaskState = isLive ? taskState : "complete";
  // Force phase to idle for completed (non-live) conversations so the
  // thinking skeleton doesn't appear when history events lack terminal events.
  const assistantPhase: AssistantPhase = isLive
    ? rawAssistantPhase
    : { phase: "idle" };

  // Merge DB-persisted messages with event-derived messages so that
  // intermediate assistant text (from llm_response events during multi-
  // iteration ReAct loops) is visible in both live and historical views.
  // DB messages table only stores TURN_COMPLETE / TASK_COMPLETE / MESSAGE_USER,
  // but llm_response events (saved to events table) carry intermediate text
  // that useAgentState correctly derives — we must not discard them.
  const effectiveMessages = useMemo<ChatMessage[]>(() => {
    const merged = [...historyMessages];
    for (const msg of messages) {
      const isDuplicate = merged.some(
        (m) =>
          m.role === msg.role &&
          m.content === msg.content &&
          Math.abs(m.timestamp - msg.timestamp) < 30_000,
      );
      if (!isDuplicate) {
        merged.push(msg);
      }
    }
    return merged;
  }, [historyMessages, messages]);

  const {
    allMessages,
    isWaitingForAgent,
    userCancelled,
    createError,
    handleSendMessage,
    handleCreateConversation,
    handleSwitchConversation,
    handleNewConversation,
    handleCancel,
    handleRetry,
  } = useConversation(effectiveMessages, effectiveTaskState, effectiveEvents, assistantPhase, clearLastTurn);

  const { pendingAsk, handlePromptSubmit, respondError } = usePendingAsk(
    effectiveEvents,
    conversationId,
  );

  const value: ConversationContextValue = {
    conversationId,
    events: effectiveEvents,
    isConnected,
    messages: effectiveMessages,
    toolCalls,
    taskState: effectiveTaskState,
    agentStatuses,
    planSteps,
    currentIteration,
    reasoningSteps,
    thinkingContent,
    isStreaming: isLive ? isStreaming : false,
    assistantPhase,
    artifacts,
    allMessages,
    isWaitingForAgent: isLive ? isWaitingForAgent : false,
    userCancelled: isLive ? userCancelled : false,
    handleSendMessage,
    handleCreateConversation,
    handleSwitchConversation,
    handleNewConversation,
    handleCancel,
    handleRetry,
    createError,
    pendingAsk,
    handlePromptSubmit,
    respondError,
    isLoadingHistory,
  };

  return (
    <ConversationContext.Provider value={value}>
      {children}
    </ConversationContext.Provider>
  );
}
