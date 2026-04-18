"use client";

import { startTransition, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/shared/stores";
import {
  createConversation,
  sendFollowUpMessage,
  cancelTurn,
  retryTurn,
} from "../api/conversation-api";
import { createOptimisticMessageId, mergeConversationMessages } from "../lib/message-identity";
import { getConversationPath } from "../lib/routes";
import type { AgentEvent, AssistantPhase, ChatMessage, TaskState } from "@/shared/types";

export interface PendingSelectedSkill {
  readonly name: string;
  readonly timestamp: number;
}

export function shouldClearWaitingForTerminalState(
  isWaitingForAgent: boolean,
  taskState: TaskState,
): boolean {
  if (!isWaitingForAgent) return false;
  return taskState === "complete" || taskState === "error";
}

export function normalizeSelectedSkills(
  skills: readonly string[] | undefined,
  timestamp: number,
): PendingSelectedSkill[] {
  if (!skills?.length) return [];
  const seen = new Set<string>();
  const normalized: PendingSelectedSkill[] = [];
  for (const skill of skills) {
    const trimmed = skill.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push({ name: trimmed, timestamp });
  }
  return normalized;
}

export function useConversation(
  transcriptMessages: ChatMessage[],
  taskState: TaskState,
  events: AgentEvent[] = [],
  assistantPhase: AssistantPhase,
  clearLastTurn?: () => void,
) {
  const router = useRouter();
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [isWaitingForAgent, setIsWaitingForAgent] = useState(false);
  const [userCancelled, setUserCancelled] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingSelectedSkills, setPendingSelectedSkills] = useState<PendingSelectedSkill[]>([]);
  const eventCountAtSendRef = useRef(events.length);
  const optimisticMessageSequenceRef = useRef(0);

  const conversationId = useAppStore((s) => s.conversationId);
  const isLiveConversation = useAppStore((s) => s.isLiveConversation);
  const startConversation = useAppStore((s) => s.startConversation);
  const switchConversation = useAppStore((s) => s.switchConversation);
  const resumeConversation = useAppStore((s) => s.resumeConversation);
  const updateConversationTitle = useAppStore((s) => s.updateConversationTitle);
  const setPendingConversationRoute = useAppStore((s) => s.setPendingConversationRoute);
  const clearPendingConversationRoute = useAppStore((s) => s.clearPendingConversationRoute);

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

  // Failsafe: clear waiting when task reaches a terminal state.
  // Handles fast responses where all events batch-arrive and both
  // taskState and assistantPhase are already idle by the time React renders.
  useEffect(() => {
    if (shouldClearWaitingForTerminalState(isWaitingForAgent, taskState)) {
      setIsWaitingForAgent(false);
      setPendingSelectedSkills([]);
    }
  }, [isWaitingForAgent, taskState]);

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
      setUserCancelled(false);
      setCreateError(null);
      setPendingSelectedSkills([]);
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
    if (userMessages.length === 0) return transcriptMessages;
    return mergeConversationMessages(userMessages, transcriptMessages);
  }, [userMessages, transcriptMessages]);

  const buildOptimisticUserMessage = useCallback(
    (message: string, timestamp: number, files?: File[]): ChatMessage => {
      const attachments = files?.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      }));
      optimisticMessageSequenceRef.current += 1;
      return {
        messageId: createOptimisticMessageId(
          conversationId ?? "new-conversation",
          optimisticMessageSequenceRef.current,
        ),
        role: "user",
        content: message,
        timestamp,
        source: "optimistic",
        ...(attachments?.length ? { attachments } : {}),
      };
    },
    [conversationId],
  );

  const handleCreateConversation = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      const now = Date.now();
      eventCountAtSendRef.current = events.length;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      setCreateError(null);
      setPendingSelectedSkills(normalizeSelectedSkills(skills, now));
      setUserMessages([buildOptimisticUserMessage(message, now, files)]);

      try {
        const data = await createConversation(message, files, skills, usePlanner);
        setPendingConversationRoute(data.conversation_id);
        startConversation(data.conversation_id, message);
        startTransition(() => {
          router.push(getConversationPath(data.conversation_id));
        });
      } catch (err) {
        console.error("Failed to create conversation:", err);
        clearPendingConversationRoute();
        setIsWaitingForAgent(false);
        setPendingSelectedSkills([]);
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
    [
      clearPendingConversationRoute,
      router,
      setPendingConversationRoute,
      startConversation,
      events.length,
    ],
  );

  const handleSendFollowUp = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      if (!conversationId) return;

      const now = Date.now();
      eventCountAtSendRef.current = events.length;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      setPendingSelectedSkills(normalizeSelectedSkills(skills, now));
      setUserMessages((prev) => [
        ...prev,
        buildOptimisticUserMessage(message, now, files),
      ]);

      try {
        await sendFollowUpMessage(conversationId, message, files, skills, usePlanner);
      } catch (err) {
        console.error("Failed to send message:", err);
        setIsWaitingForAgent(false);
        setPendingSelectedSkills([]);
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
    [buildOptimisticUserMessage, conversationId, events.length],
  );

  const handleResumeConversation = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      if (!conversationId) return;

      const now = Date.now();
      eventCountAtSendRef.current = events.length;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      setPendingSelectedSkills(normalizeSelectedSkills(skills, now));
      setUserMessages((prev) => [
        ...prev,
        buildOptimisticUserMessage(message, now, files),
      ]);

      try {
        await sendFollowUpMessage(conversationId, message, files, skills, usePlanner);
        resumeConversation();
      } catch (err) {
        console.error("Failed to resume conversation:", err);
        setIsWaitingForAgent(false);
        setPendingSelectedSkills([]);
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
    [buildOptimisticUserMessage, conversationId, resumeConversation, events.length],
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
      setIsWaitingForAgent(false);
      setUserCancelled(false);
      setCreateError(null);
      setPendingSelectedSkills([]);
    },
    [conversationId, switchConversation],
  );

  const handleNewConversation = useCallback(() => {
    clearPendingConversationRoute();
    setUserMessages([]);
    setIsWaitingForAgent(false);
    setUserCancelled(false);
    setCreateError(null);
    setPendingSelectedSkills([]);
    startTransition(() => {
      router.push("/");
    });
  }, [clearPendingConversationRoute, router]);

  const handleCancel = useCallback(() => {
    if (!conversationId) return;
    setIsWaitingForAgent(false);
    setUserCancelled(true);
    setPendingSelectedSkills([]);
    // Fire and forget — don't block the UI on the backend cancel
    cancelTurn(conversationId).catch((err) => {
      console.error("Failed to cancel turn:", err);
      setUserCancelled(false);
    });
  }, [conversationId]);

  const handleRetry = useCallback(async () => {
    if (!conversationId) return;
    try {
      clearLastTurn?.();
      const result = await retryTurn(conversationId);
      if (result.status === "retrying") {
        eventCountAtSendRef.current = events.length;
        setUserCancelled(false);
        setIsWaitingForAgent(true);
        setPendingSelectedSkills([]);
      }
    } catch (err) {
      console.error("Failed to retry turn:", err);
    }
  }, [conversationId, events.length, clearLastTurn]);

  return {
    conversationId,
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
  };
}
