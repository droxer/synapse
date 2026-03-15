"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useAppStore } from "@/shared/stores";
import {
  createConversation,
  sendFollowUpMessage,
} from "../api/conversation-api";
import type { ChatMessage, TaskState } from "@/shared/types";

export function useConversation(
  assistantMessages: ChatMessage[],
  taskState: TaskState,
) {
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);

  const {
    conversationId,
    conversationHistory,
    sidebarCollapsed,
    startConversation,
    updateConversationStatus,
    resetConversation,
  } = useAppStore();

  // Update conversation status in sidebar
  useEffect(() => {
    if (!conversationId) return;
    if (taskState === "complete") {
      updateConversationStatus(conversationId, "complete");
    } else if (taskState === "error") {
      updateConversationStatus(conversationId, "error");
    }
  }, [conversationId, taskState, updateConversationStatus]);

  const allMessages = useMemo(() => {
    const combined = [...userMessages, ...assistantMessages];
    return [...combined].sort((a, b) => a.timestamp - b.timestamp);
  }, [userMessages, assistantMessages]);

  const handleCreateConversation = useCallback(
    async (message: string) => {
      setUserMessages([
        { role: "user", content: message, timestamp: Date.now() },
      ]);

      try {
        const data = await createConversation(message);
        startConversation(data.conversation_id, message);
      } catch (err) {
        console.error("Failed to create conversation:", err);
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
    [startConversation],
  );

  const handleSendFollowUp = useCallback(
    async (message: string) => {
      if (!conversationId) return;

      setUserMessages((prev) => [
        ...prev,
        { role: "user", content: message, timestamp: Date.now() },
      ]);

      try {
        await sendFollowUpMessage(conversationId, message);
      } catch (err) {
        console.error("Failed to send message:", err);
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
    [conversationId],
  );

  const handleSendMessage = useCallback(
    (message: string) => {
      if (!conversationId) {
        handleCreateConversation(message);
      } else {
        handleSendFollowUp(message);
      }
    },
    [conversationId, handleCreateConversation, handleSendFollowUp],
  );

  const handleNewConversation = useCallback(() => {
    resetConversation();
    setUserMessages([]);
  }, [resetConversation]);

  return {
    conversationId,
    conversationHistory,
    sidebarCollapsed,
    allMessages,
    handleSendMessage,
    handleCreateConversation,
    handleNewConversation,
  };
}
