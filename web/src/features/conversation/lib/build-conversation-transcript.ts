import {
  deriveAgentState,
  type DerivedAgentState,
} from "@/features/agent-computer/hooks/use-agent-state";
import type { AgentEvent, ChatMessage } from "@/shared/types";
import { mergeHistoryWithEventDerivedMessages } from "./merge-transcript-messages";
import { mergeUniqueEvents } from "./merge-unique-events";

export interface ConversationTranscriptState {
  readonly effectiveEvents: readonly AgentEvent[];
  readonly messages: readonly ChatMessage[];
  readonly agentState: DerivedAgentState;
}

export function buildConversationTranscriptState(
  historyMessages: readonly ChatMessage[],
  historyEvents: readonly AgentEvent[],
  liveEvents: readonly AgentEvent[],
): ConversationTranscriptState {
  const effectiveEvents = mergeUniqueEvents(historyEvents, liveEvents);
  const agentState = deriveAgentState(effectiveEvents);
  const messages = mergeHistoryWithEventDerivedMessages(historyMessages, agentState.messages);

  return {
    effectiveEvents,
    messages,
    agentState,
  };
}
