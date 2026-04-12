"use client";

import { createContext, useMemo, useRef, type ReactNode } from "react";
import { useSSE, useSessionFilteredArtifacts } from "@/shared/hooks";
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
  ThinkingEntry,
  ToolCallInfo,
  TaskState,
  AgentStatus,
  PlanStep,
} from "@/shared/types";
import { getEventKey, mergeUniqueEvents } from "../lib/merge-unique-events";
import { mergeHistoryWithEventDerivedMessages } from "../lib/merge-transcript-messages";

// ── Incremental event merge hook ────────────────────────────────────
// Reuses prior merge results: only processes newly-appended live events
// and skips the full O(N) deep-serialization + sort on every render.

interface IncrementalMergeState {
  seenKeys: Set<string>;
  merged: AgentEvent[];
  /** How many history events were used in the last full rebuild. */
  historyLen: number;
  /** How many live events have been incrementally processed so far. */
  liveProcessed: number;
  /** Reference identity of the history array used in the last rebuild. */
  historyRef: readonly AgentEvent[] | null;
}

function useIncrementalMerge(
  historyEvents: readonly AgentEvent[],
  liveEvents: readonly AgentEvent[],
  isLive: boolean,
): AgentEvent[] {
  const stateRef = useRef<IncrementalMergeState>({
    seenKeys: new Set(),
    merged: [],
    historyLen: 0,
    liveProcessed: 0,
    historyRef: null,
  });

  return useMemo(() => {
    if (!isLive) return historyEvents as AgentEvent[];

    const s = stateRef.current;

    // Full rebuild when history changes (rare: initial load / conversation switch).
    const historyChanged =
      s.historyRef !== historyEvents || s.historyLen !== historyEvents.length;

    if (historyChanged) {
      // Rebuild from scratch with current history + all live events.
      const result = mergeUniqueEvents(historyEvents, liveEvents);
      // Capture state for future incremental updates.
      const seenKeys = new Set<string>();
      for (const event of result) {
        seenKeys.add(getEventKey(event));
      }
      stateRef.current = {
        seenKeys,
        merged: result,
        historyLen: historyEvents.length,
        liveProcessed: liveEvents.length,
        historyRef: historyEvents,
      };
      return result;
    }

    // Incremental: only process newly-appended live events.
    if (liveEvents.length <= s.liveProcessed) {
      // Live events shrank (e.g. clearLastTurn) — rebuild.
      if (liveEvents.length < s.liveProcessed) {
        const result = mergeUniqueEvents(historyEvents, liveEvents);
        const seenKeys = new Set<string>();
        for (const event of result) {
          seenKeys.add(getEventKey(event));
        }
        stateRef.current = {
          seenKeys,
          merged: result,
          historyLen: historyEvents.length,
          liveProcessed: liveEvents.length,
          historyRef: historyEvents,
        };
        return result;
      }
      // No new events — return cached.
      return s.merged;
    }

    // Append new live events that aren't duplicates of history.
    let added = false;
    for (let i = s.liveProcessed; i < liveEvents.length; i++) {
      const event = liveEvents[i];
      const key = getEventKey(event);
      if (!s.seenKeys.has(key)) {
        s.seenKeys.add(key);
        s.merged.push(event);
        added = true;
      }
    }
    s.liveProcessed = liveEvents.length;

    // Return a new reference only when events were actually added so
    // downstream useMemo / React.memo can skip work when nothing changed.
    if (added) {
      s.merged = [...s.merged];
    }
    return s.merged;
  }, [historyEvents, liveEvents, isLive]);
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
  readonly thinkingDurationMs: number;
  readonly currentThinkingEntries: ThinkingEntry[];
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
  // Uses incremental merge to avoid O(N) deep serialization on every SSE batch.
  const effectiveEvents = useIncrementalMerge(historyEvents, events, isLive);

  const {
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
    assistantPhase: rawAssistantPhase,
    artifacts: rawArtifacts,
  } = useAgentState(effectiveEvents);

  const artifacts = useSessionFilteredArtifacts(rawArtifacts);

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
    return mergeHistoryWithEventDerivedMessages(historyMessages, messages);
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

  const effectiveIsStreaming = isLive ? isStreaming : false;
  const effectiveIsWaitingForAgent = isLive ? isWaitingForAgent : (!conversationId && isWaitingForAgent);
  const effectiveUserCancelled = isLive ? userCancelled : false;

  const value = useMemo<ConversationContextValue>(
    () => ({
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
      thinkingDurationMs,
      currentThinkingEntries,
      isStreaming: effectiveIsStreaming,
      assistantPhase,
      artifacts,
      allMessages,
      isWaitingForAgent: effectiveIsWaitingForAgent,
      userCancelled: effectiveUserCancelled,
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
    }),
    [
      conversationId, effectiveEvents, isConnected, effectiveMessages,
      toolCalls, effectiveTaskState, agentStatuses, planSteps,
      currentIteration, reasoningSteps, thinkingContent, thinkingDurationMs,
      currentThinkingEntries, effectiveIsStreaming, assistantPhase, artifacts,
      allMessages, effectiveIsWaitingForAgent, effectiveUserCancelled,
      handleSendMessage, handleCreateConversation, handleSwitchConversation,
      handleNewConversation, handleCancel, handleRetry, createError,
      pendingAsk, handlePromptSubmit, respondError, isLoadingHistory,
    ],
  );

  return (
    <ConversationContext.Provider value={value}>
      {children}
    </ConversationContext.Provider>
  );
}
