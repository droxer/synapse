"use client";

import { InputPrompt } from "./InputPrompt";
import { useConversationContext } from "../hooks/use-conversation-context";

export function PendingAskOverlay() {
  const { pendingAsk, handlePromptSubmit, respondError } =
    useConversationContext();

  if (!pendingAsk) return null;

  return (
    <div>
      <InputPrompt
        question={pendingAsk.question}
        onSubmit={handlePromptSubmit}
      />
      {respondError && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border border-destructive/40 bg-background px-4 py-2.5 text-sm text-destructive shadow-card"
        >
          {respondError}
        </div>
      )}
    </div>
  );
}
