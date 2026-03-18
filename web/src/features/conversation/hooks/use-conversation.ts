"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useAppStore } from "@/shared/stores";
import {
  createConversation,
  sendFollowUpMessage,
  cancelTurn,
  retryTurn,
} from "../api/conversation-api";
import type { AgentEvent, AssistantPhase, ChatMessage, TaskState } from "@/shared/types";

export function useConversation(
  transcriptMessages: ChatMessage[],
  taskState: TaskState,
  events: AgentEvent[] = [],
  assistantPhase: AssistantPhase,
  clearLastTurn?: () => void,
) {
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [isWaitingForAgent, setIsWaitingForAgent] = useState(false);
  const [userCancelled, setUserCancelled] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const eventCountAtSendRef = useRef(events.length);

  const conversationId = useAppStore((s) => s.conversationId);
  const isLiveConversation = useAppStore((s) => s.isLiveConversation);
  const startConversation = useAppStore((s) => s.startConversation);
  const switchConversation = useAppStore((s) => s.switchConversation);
  const resumeConversation = useAppStore((s) => s.resumeConversation);
  const updateConversationTitle = useAppStore((s) => s.updateConversationTitle);
  const resetConversation = useAppStore((s) => s.resetConversation);

  // Clear waiting state only when NEW events arrive (after send) and
  // the assistant has actually started responding. This prevents the
  // skeleton from being immediately cleared by stale events from prior turns.
  useEffect(() => {
    if (!isWaitingForAgent) return;
    const hasNewEvents = events.length > eventCountAtSendRef.current;
    if (hasNewEvents && (taskState !== "idle" || assistantPhase.phase !== "idle")) {
      setIsWaitingForAgent(false);
    }
  }, [isWaitingForAgent, taskState, events.length, assistantPhase.phase]);

  // Clear userCancelled when the backend confirms cancellation via SSE
  useEffect(() => {
    if (userCancelled && (taskState === "idle" || taskState === "complete")) {
      setUserCancelled(false);
    }
  }, [userCancelled, taskState]);

  // Reset local state when switching away from a conversation externally
  // (e.g. sidebar). We track the previous ID to avoid clearing state when
  // conversationId transitions from null → newId (initial creation), since
  // that would wipe out `isWaitingForAgent` set by handleCreateConversation.
  const prevConversationIdRef = useRef<string | null>(conversationId);
  useEffect(() => {
    const prev = prevConversationIdRef.current;
    prevConversationIdRef.current = conversationId;
    if (prev !== null && prev !== conversationId) {
      setUserMessages([]);
      setIsWaitingForAgent(false);
    }
  }, [conversationId]);

  // Update conversation title when the LLM generates one
  const lastTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    const titleEvent = events.find((e) => e.type === "conversation_title");
    if (titleEvent) {
      const title = titleEvent.data.title as string;
      if (title && title !== lastTitleRef.current) {
        lastTitleRef.current = title;
        updateConversationTitle(conversationId, title);
      }
    }
  }, [conversationId, events, updateConversationTitle]);

  const allMessages = useMemo(() => {
    const pendingMessages = userMessages.filter((pending) => {
      return !transcriptMessages.some(
        (persisted) =>
          persisted.role === pending.role &&
          persisted.content === pending.content &&
          Math.abs(persisted.timestamp - pending.timestamp) < 30_000,
      );
    });
    const combined = [...pendingMessages, ...transcriptMessages];
    return [...combined].sort((a, b) => a.timestamp - b.timestamp);
  }, [userMessages, transcriptMessages]);

  const handleCreateConversation = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      eventCountAtSendRef.current = events.length;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      setCreateError(null);
      const attachmentMeta = files?.map(f => ({ name: f.name, size: f.size, type: f.type }));
      setUserMessages([
        { role: "user", content: message, timestamp: Date.now(), ...(attachmentMeta?.length ? { attachments: attachmentMeta } : {}) },
      ]);

      try {
        const data = await createConversation(message, files, skills, usePlanner);
        startConversation(data.conversation_id, message);
      } catch (err) {
        console.error("Failed to create conversation:", err);
        setIsWaitingForAgent(false);
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setCreateError(`Failed to start conversation: ${errorMessage}`);
        setUserMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${errorMessage}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [startConversation, events.length],
  );

  const handleSendFollowUp = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      if (!conversationId) return;

      eventCountAtSendRef.current = events.length;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      const attachmentMeta = files?.map(f => ({ name: f.name, size: f.size, type: f.type }));
      setUserMessages((prev) => [
        ...prev,
        { role: "user", content: message, timestamp: Date.now(), ...(attachmentMeta?.length ? { attachments: attachmentMeta } : {}) },
      ]);

      try {
        await sendFollowUpMessage(conversationId, message, files, skills, usePlanner);
      } catch (err) {
        console.error("Failed to send message:", err);
        setIsWaitingForAgent(false);
        setUserMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [conversationId, events.length],
  );

  const handleResumeConversation = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      if (!conversationId) return;

      eventCountAtSendRef.current = events.length;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      const attachmentMeta = files?.map(f => ({ name: f.name, size: f.size, type: f.type }));
      setUserMessages((prev) => [
        ...prev,
        { role: "user", content: message, timestamp: Date.now(), ...(attachmentMeta?.length ? { attachments: attachmentMeta } : {}) },
      ]);

      try {
        await sendFollowUpMessage(conversationId, message, files, skills, usePlanner);
        resumeConversation();
      } catch (err) {
        console.error("Failed to resume conversation:", err);
        setIsWaitingForAgent(false);
        setUserMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [conversationId, resumeConversation, events.length],
  );

  const handleSendMessage = useCallback(
    (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      if (!conversationId) {
        handleCreateConversation(message, files, skills, usePlanner);
      } else if (!isLiveConversation) {
        handleResumeConversation(message, files, skills, usePlanner);
      } else {
        handleSendFollowUp(message, files, skills, usePlanner);
      }
    },
    [conversationId, isLiveConversation, handleCreateConversation, handleResumeConversation, handleSendFollowUp],
  );

  const handleSwitchConversation = useCallback(
    (id: string) => {
      if (id === conversationId) return;
      switchConversation(id);
      setUserMessages([]);
    },
    [conversationId, switchConversation],
  );

  const handleNewConversation = useCallback(() => {
    resetConversation();
    setUserMessages([]);
  }, [resetConversation]);

  const handleCancel = useCallback(() => {
    if (!conversationId) return;
    setIsWaitingForAgent(false);
    setUserCancelled(true);
    // Fire and forget — don't block the UI on the backend cancel
    cancelTurn(conversationId).catch((err) => {
      console.error("Failed to cancel turn:", err);
    });
  }, [conversationId]);

  const handleRetry = useCallback(async () => {
    if (!conversationId) return;
    try {
      clearLastTurn?.();
      const result = await retryTurn(conversationId);
      if (result.status === "retrying") {
        eventCountAtSendRef.current = events.length;
        setIsWaitingForAgent(true);
      }
    } catch (err) {
      console.error("Failed to retry turn:", err);
    }
  }, [conversationId, events.length, clearLastTurn]);

  return {
    conversationId,
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
  };
}
