"use client";

import { createContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useSSE, useSessionFilteredArtifacts } from "@/shared/hooks";
import { useAppStore } from "@/shared/stores";
import { useConversation } from "../hooks/use-conversation";
import { useConversationHistory } from "../hooks/use-conversation-history";
import { usePendingAsk } from "../hooks/use-pending-ask";
import { useConversationTranscript } from "../hooks/use-conversation-transcript";
import { shouldConnectConversationEvents } from "./conversation-event-connection";
import { buildOptimisticSkillToolCalls } from "@/features/agent-computer/lib/optimistic-skill-tool-calls";
import type { PendingSelectedSkill } from "../hooks/use-conversation";
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
  PreviewSession,
} from "@/shared/types";

export interface ConversationStateValue {
  readonly conversationId: string | null;
  readonly events: readonly AgentEvent[];
  readonly isConnected: boolean;
  readonly messages: readonly ChatMessage[];
  readonly toolCalls: readonly ToolCallInfo[];
  readonly taskState: TaskState;
  readonly agentStatuses: readonly AgentStatus[];
  readonly planSteps: readonly PlanStep[];
  readonly currentIteration: number;
  readonly reasoningSteps: readonly string[];
  readonly thinkingContent: string;
  readonly thinkingDurationMs: number;
  readonly currentThinkingEntries: readonly ThinkingEntry[];
  readonly isStreaming: boolean;
  readonly assistantPhase: AssistantPhase;
  readonly artifacts: readonly ArtifactInfo[];
  readonly previewSession: PreviewSession | null;
  readonly allMessages: readonly ChatMessage[];
  readonly pendingSelectedSkills: readonly PendingSelectedSkill[];
  readonly explicitPlannerPending: boolean;
  readonly isWaitingForAgent: boolean;
  readonly userCancelled: boolean;
  readonly createError: string | null;
  readonly pendingAsk: ReturnType<typeof usePendingAsk>["pendingAsk"];
  readonly respondError: string | null;
  readonly isLoadingHistory: boolean;
}

export interface ConversationActionsValue {
  readonly handleSendMessage: (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => void;
  readonly handleCreateConversation: (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => void;
  readonly handleSwitchConversation: (conversationId: string) => void;
  readonly handleNewConversation: () => void;
  readonly handleCancel: () => void;
  readonly handleRetry: () => void;
  readonly handlePromptSubmit: (response: string) => Promise<void>;
}

/** @deprecated Use ConversationStateValue & ConversationActionsValue instead */
export type ConversationContextValue = ConversationStateValue & ConversationActionsValue;

export const ConversationStateContext =
  createContext<ConversationStateValue | null>(null);

export const ConversationActionsContext =
  createContext<ConversationActionsValue | null>(null);

/** @deprecated Kept for backward compatibility — prefer the split contexts */
export const ConversationContext =
  createContext<ConversationContextValue | null>(null);

interface ConversationProviderProps {
  readonly children: ReactNode;
}

export type TerminalHistoryRefetchMode = "none" | "transcript" | "all";

export function getHistoryRefetchModeForTerminalEvent(
  event: AgentEvent | undefined,
): TerminalHistoryRefetchMode {
  if (event?.type === "task_complete") {
    return "all";
  }
  if (
    event?.type === "turn_complete"
    || event?.type === "turn_cancelled"
    || event?.type === "task_error"
  ) {
    return "transcript";
  }
  return "none";
}

export function shouldRefetchHistoryForTerminalEvent(
  event: AgentEvent | undefined,
): boolean {
  return getHistoryRefetchModeForTerminalEvent(event) !== "none";
}

export function ConversationProvider({ children }: ConversationProviderProps) {
  const conversationId = useAppStore((s) => s.conversationId);
  const isLive = useAppStore((s) => s.isLiveConversation);
  const pendingConversationRouteId = useAppStore((s) => s.pendingConversationRouteId);

  const {
    historyMessages,
    historyEvents,
    historyArtifacts,
    isLoading: isLoadingHistory,
    refetchAllHistory,
    refetchTranscriptHistory,
  } = useConversationHistory(conversationId);
  const shouldConnectEvents = shouldConnectConversationEvents(
    conversationId,
    isLive,
    isLoadingHistory,
    pendingConversationRouteId,
  );
  const { events, isConnected, clearLastTurn } = useSSE(
    conversationId,
    shouldConnectEvents,
  );

  const {
    effectiveEvents,
    messages: effectiveMessages,
    artifacts: transcriptArtifacts,
    agentState: {
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
      previewSession,
    },
  } = useConversationTranscript(
    historyMessages,
    historyEvents,
    historyArtifacts,
    events,
    isLive,
  );

  const artifacts = useSessionFilteredArtifacts(transcriptArtifacts);
  const lastTerminalEventKeyRef = useRef<string | null>(null);
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    lastTerminalEventKeyRef.current = null;
    wasConnectedRef.current = false;
  }, [conversationId]);

  useEffect(() => {
    if (!isLive) {
      return;
    }
    const lastEvent = effectiveEvents[effectiveEvents.length - 1];
    const refetchMode = getHistoryRefetchModeForTerminalEvent(lastEvent);
    if (refetchMode === "none") {
      return;
    }
    const key = `${lastEvent.type}:${lastEvent.timestamp}:${lastEvent.iteration ?? ""}`;
    if (lastTerminalEventKeyRef.current === key) {
      return;
    }
    lastTerminalEventKeyRef.current = key;
    if (refetchMode === "all") {
      void refetchAllHistory();
      return;
    }
    void refetchTranscriptHistory();
  }, [effectiveEvents, isLive, refetchAllHistory, refetchTranscriptHistory]);

  useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
      return;
    }
    if (!wasConnectedRef.current || !isLive || !conversationId) {
      return;
    }
    void refetchAllHistory();
  }, [conversationId, isConnected, isLive, refetchAllHistory]);

  const effectiveTaskState: TaskState = isLive ? taskState : "complete";
  // Force phase to idle for completed (non-live) conversations so the
  // thinking skeleton doesn't appear when history events lack terminal events.
  const assistantPhase = useMemo<AssistantPhase>(
    () => (isLive ? rawAssistantPhase : { phase: "idle" }),
    [isLive, rawAssistantPhase],
  );

  const {
    allMessages,
    pendingSelectedSkills,
    explicitPlannerPending,
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
  const effectiveToolCalls = useMemo(
    () => [...buildOptimisticSkillToolCalls(pendingSelectedSkills, toolCalls), ...toolCalls],
    [pendingSelectedSkills, toolCalls],
  );

  const stateValue = useMemo<ConversationStateValue>(
    () => ({
      conversationId,
      events: effectiveEvents,
      isConnected,
      messages: effectiveMessages,
      toolCalls: effectiveToolCalls,
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
      previewSession,
      allMessages,
      pendingSelectedSkills,
      explicitPlannerPending,
      isWaitingForAgent: effectiveIsWaitingForAgent,
      userCancelled: effectiveUserCancelled,
      createError,
      pendingAsk,
      respondError,
      isLoadingHistory,
    }),
    [
      conversationId, effectiveEvents, isConnected, effectiveMessages,
      effectiveToolCalls, effectiveTaskState, agentStatuses, planSteps,
      currentIteration, reasoningSteps, thinkingContent, thinkingDurationMs,
      currentThinkingEntries, effectiveIsStreaming, assistantPhase, artifacts,
      previewSession, allMessages, pendingSelectedSkills, effectiveIsWaitingForAgent, effectiveUserCancelled,
      explicitPlannerPending, createError, pendingAsk, respondError, isLoadingHistory,
    ],
  );

  const actionsValue = useMemo<ConversationActionsValue>(
    () => ({
      handleSendMessage,
      handleCreateConversation,
      handleSwitchConversation,
      handleNewConversation,
      handleCancel,
      handleRetry,
      handlePromptSubmit,
    }),
    [
      handleSendMessage, handleCreateConversation, handleSwitchConversation,
      handleNewConversation, handleCancel, handleRetry, handlePromptSubmit,
    ],
  );

  // Combined value for backward compat
  const combinedValue = useMemo<ConversationContextValue>(
    () => ({ ...stateValue, ...actionsValue }),
    [stateValue, actionsValue],
  );

  return (
    <ConversationContext.Provider value={combinedValue}>
      <ConversationActionsContext.Provider value={actionsValue}>
        <ConversationStateContext.Provider value={stateValue}>
          {children}
        </ConversationStateContext.Provider>
      </ConversationActionsContext.Provider>
    </ConversationContext.Provider>
  );
}
