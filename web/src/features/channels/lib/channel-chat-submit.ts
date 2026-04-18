interface PendingAskState {
  readonly requestId: string;
  readonly question: string;
}

interface SubmitChannelMessageArgs {
  readonly message: string;
  readonly pendingAsk: PendingAskState | null;
  readonly sendFollowUp: (message: string) => Promise<void>;
  readonly respondToPrompt: (response: string) => Promise<void>;
}

export async function submitChannelMessage({
  message,
  pendingAsk,
  sendFollowUp,
  respondToPrompt,
}: SubmitChannelMessageArgs): Promise<"prompt_response" | "follow_up"> {
  if (pendingAsk) {
    await respondToPrompt(message);
    return "prompt_response";
  }

  await sendFollowUp(message);
  return "follow_up";
}
