"use client";

import { createContext, type ReactNode } from "react";
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
} from "@/shared/types";

export interface ConversationContextValue {
  readonly conversationId: string | null;
  readonly events: AgentEvent[];
  readonly isConnected: boolean;
  readonly messages: ChatMessage[];
  readonly toolCalls: ToolCallInfo[];
  readonly taskState: TaskState;
  readonly agentStatuses: AgentStatus[];
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
  const { historyMessages, historyEvents } = useConversationHistory(conversationId);

  // Merge history events with live SSE events so the progress card shows
  // persisted activity even after a page refresh (SSE stream starts empty).
  const effectiveEvents = isLive ? [...historyEvents, ...events] : historyEvents;

  const {
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
  } = useAgentState(effectiveEvents);

  const effectiveTaskState: TaskState = isLive ? taskState : "complete";
  const effectiveMessages = isLive
    ? [...historyMessages, ...messages]
    : historyMessages;

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
  };

  return (
    <ConversationContext.Provider value={value}>
      {children}
    </ConversationContext.Provider>
  );
}
