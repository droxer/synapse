"use client";

import { useState, useCallback, useMemo } from "react";
import { respondToAgent } from "../api/conversation-api";
import type { AgentEvent } from "@/shared/types";

interface PendingAskOption {
  readonly id?: string;
  readonly label: string;
  readonly value?: string;
  readonly description?: string;
}

interface PendingAsk {
  readonly requestId: string;
  readonly title?: string;
  readonly question: string;
  readonly options: readonly PendingAskOption[];
  readonly allowFreeform: boolean;
}

export function derivePendingAskFromEvents(events: readonly AgentEvent[]): PendingAsk | null {
  const askEvents = events.filter((e) => e.type === "ask_user");
  const responseEvents = events.filter((e) => e.type === "user_response");

  const respondedIds = new Set(
    responseEvents.map((e) => String(e.data.request_id ?? "")),
  );

  for (let index = askEvents.length - 1; index >= 0; index -= 1) {
    const ask = askEvents[index]!;
    const requestId = String(ask.data.request_id ?? "");
    if (!requestId || respondedIds.has(requestId)) {
      continue;
    }
    const options = Array.isArray(ask.data.options)
      ? ask.data.options
          .filter(
            (
              option,
            ): option is PendingAskOption =>
              Boolean(option)
              && typeof option === "object"
              && typeof (option as { label?: unknown }).label === "string",
          )
          .map((option) => ({
            id: option.id,
            label: option.label,
            value: option.value,
            description: option.description,
          }))
      : [];
    const metadata =
      ask.data.prompt_metadata && typeof ask.data.prompt_metadata === "object"
        ? ask.data.prompt_metadata as { allow_freeform?: unknown }
        : undefined;
    return {
      requestId,
      title:
        typeof ask.data.title === "string" && ask.data.title.trim()
          ? ask.data.title
          : undefined,
      question: String(ask.data.message ?? ask.data.question ?? ""),
      options,
      allowFreeform:
        typeof metadata?.allow_freeform === "boolean"
          ? metadata.allow_freeform
          : true,
    };
  }

  return null;
}

export function usePendingAsk(
  events: AgentEvent[],
  conversationId: string | null,
) {
  const [respondError, setRespondError] = useState<string | null>(null);

  const pendingAsk = useMemo(() => derivePendingAskFromEvents(events), [events]);

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
