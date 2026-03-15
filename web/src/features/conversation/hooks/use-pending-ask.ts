"use client";

import { useState, useCallback, useMemo } from "react";
import { respondToAgent } from "../api/conversation-api";
import type { AgentEvent } from "@/shared/types";

export function usePendingAsk(
  events: AgentEvent[],
  conversationId: string | null,
) {
  const [respondError, setRespondError] = useState<string | null>(null);

  const pendingAsk = useMemo(() => {
    const askEvents = events.filter((e) => e.type === "ask_user");
    const responseEvents = events.filter((e) => e.type === "user_response");

    const respondedIds = new Set(
      responseEvents.map((e) => String(e.data.request_id ?? "")),
    );

    for (const ask of askEvents) {
      const requestId = String(ask.data.request_id ?? "");
      if (requestId && !respondedIds.has(requestId)) {
        return {
          requestId,
          question: String(ask.data.message ?? ask.data.question ?? ""),
        };
      }
    }
    return null;
  }, [events]);

  const handlePromptSubmit = useCallback(
    async (response: string) => {
      if (!conversationId || !pendingAsk) return;

      setRespondError(null);
      try {
        await respondToAgent(conversationId, pendingAsk.requestId, response);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to send response";
        console.error("Failed to send response:", err);
        setRespondError(message);
      }
    },
    [conversationId, pendingAsk],
  );

  return { pendingAsk, handlePromptSubmit, respondError };
}
