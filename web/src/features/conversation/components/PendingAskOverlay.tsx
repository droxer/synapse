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
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-destructive/90 px-4 py-2 text-sm text-destructive-foreground shadow-lg">
          {respondError}
        </div>
      )}
    </div>
  );
}
