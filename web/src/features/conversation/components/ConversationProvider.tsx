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
  readonly pendingSelectedSkills: readonly PendingSelectedSkill[];
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
  const pendingConversationRouteId = useAppStore((s) => s.pendingConversationRouteId);

  const {
    historyMessages,
    historyEvents,
    historyArtifacts,
    isLoading: isLoadingHistory,
    refetchHistory,
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
    const lastEvent = effectiveEvents[effectiveEvents.length - 1];
    if (
      lastEvent?.type !== "turn_complete"
      && lastEvent?.type !== "task_complete"
      && lastEvent?.type !== "turn_cancelled"
      && lastEvent?.type !== "task_error"
    ) {
      return;
    }
    const key = `${lastEvent.type}:${lastEvent.timestamp}:${lastEvent.iteration ?? ""}`;
    if (lastTerminalEventKeyRef.current === key) {
      return;
    }
    lastTerminalEventKeyRef.current = key;
    void refetchHistory();
  }, [effectiveEvents, refetchHistory]);

  useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
      return;
    }
    if (!wasConnectedRef.current || !isLive || !conversationId) {
      return;
    }
    void refetchHistory();
  }, [conversationId, isConnected, isLive, refetchHistory]);

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

  const value = useMemo<ConversationContextValue>(
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
      allMessages,
      pendingSelectedSkills,
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
      effectiveToolCalls, effectiveTaskState, agentStatuses, planSteps,
      currentIteration, reasoningSteps, thinkingContent, thinkingDurationMs,
      currentThinkingEntries, effectiveIsStreaming, assistantPhase, artifacts,
      allMessages, pendingSelectedSkills, effectiveIsWaitingForAgent, effectiveUserCancelled,
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
