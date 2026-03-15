"use client";

import { createContext, type ReactNode } from "react";
import { useSSE } from "@/shared/hooks";
import { useAppStore } from "@/shared/stores";
import { useAgentState } from "@/features/agent-computer";
import { useConversation } from "../hooks/use-conversation";
import { usePendingAsk } from "../hooks/use-pending-ask";
import type {
  AgentEvent,
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
  readonly allMessages: ChatMessage[];
  readonly conversationHistory: ReturnType<typeof useConversation>["conversationHistory"];
  readonly sidebarCollapsed: boolean;
  readonly handleSendMessage: (message: string) => void;
  readonly handleCreateConversation: (message: string) => void;
  readonly handleNewConversation: () => void;
  readonly toggleSidebar: () => void;
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
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  const { events, isConnected } = useSSE(conversationId);
  const {
    messages,
    toolCalls,
    taskState,
    agentStatuses,
    currentIteration,
    reasoningSteps,
    thinkingContent,
  } = useAgentState(events);

  const {
    conversationHistory,
    sidebarCollapsed,
    allMessages,
    handleSendMessage,
    handleCreateConversation,
    handleNewConversation,
  } = useConversation(messages, taskState);

  const { pendingAsk, handlePromptSubmit, respondError } = usePendingAsk(
    events,
    conversationId,
  );

  const value: ConversationContextValue = {
    conversationId,
    events,
    isConnected,
    messages,
    toolCalls,
    taskState,
    agentStatuses,
    currentIteration,
    reasoningSteps,
    thinkingContent,
    allMessages,
    conversationHistory,
    sidebarCollapsed,
    handleSendMessage,
    handleCreateConversation,
    handleNewConversation,
    toggleSidebar,
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
