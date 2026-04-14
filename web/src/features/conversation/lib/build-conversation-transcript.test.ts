import { describe, expect, it } from "@jest/globals";
import { buildConversationTranscriptState } from "./build-conversation-transcript";
import type { AgentEvent, ChatMessage } from "@/shared/types";

describe("buildConversationTranscriptState", () => {
  it("produces one shared merged transcript for history and live events", () => {
    const historyMessages: ChatMessage[] = [
      { role: "user", content: "Question", timestamp: 1000 },
      { role: "assistant", content: "Final answer", timestamp: 4000 },
    ];
    const historyEvents: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "Question" },
        timestamp: 1000,
        iteration: null,
      },
      {
        type: "llm_response",
        data: { text: "Final answer", stop_reason: "end_turn" },
        timestamp: 4000,
        iteration: null,
      },
    ];
    const liveEvents: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "Question" },
        timestamp: 1000,
        iteration: null,
      },
      {
        type: "llm_response",
        data: { text: "Partial answer", stop_reason: "max_tokens" },
        timestamp: 2500,
        iteration: null,
      },
      {
        type: "llm_response",
        data: { text: "Final answer", stop_reason: "end_turn" },
        timestamp: 4000,
        iteration: null,
      },
    ];

    const transcript = buildConversationTranscriptState(
      historyMessages,
      historyEvents,
      liveEvents,
    );

    expect(transcript.effectiveEvents).toHaveLength(3);
    expect(transcript.messages.map((message) => message.content)).toEqual([
      "Question",
      "Partial answer",
      "Final answer",
    ]);
  });
});
