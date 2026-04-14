"use client";

import { createContext, useMemo, type ReactNode } from "react";
import { useSSE, useSessionFilteredArtifacts } from "@/shared/hooks";
import { useAppStore } from "@/shared/stores";
import { useConversation } from "../hooks/use-conversation";
import { useConversationHistory } from "../hooks/use-conversation-history";
import { usePendingAsk } from "../hooks/use-pending-ask";
import { useConversationTranscript } from "../hooks/use-conversation-transcript";
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

export interface ConversationContextValue {
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
  readonly allMessages: readonly ChatMessage[];
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

  const {
    effectiveEvents,
    messages: effectiveMessages,
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
      artifacts: rawArtifacts,
    },
  } = useConversationTranscript(historyMessages, historyEvents, events, isLive);

  const artifacts = useSessionFilteredArtifacts(rawArtifacts);

  const effectiveTaskState: TaskState = isLive ? taskState : "complete";
  // Force phase to idle for completed (non-live) conversations so the
  // thinking skeleton doesn't appear when history events lack terminal events.
  const assistantPhase = useMemo<AssistantPhase>(
    () => (isLive ? rawAssistantPhase : { phase: "idle" }),
    [isLive, rawAssistantPhase],
  );

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
