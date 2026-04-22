import { describe, expect, it } from "@jest/globals";
import { buildConversationTranscriptState } from "./build-conversation-transcript";
import { resolveConversationHistoryResults } from "../hooks/use-conversation-history";
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

  it("keeps replayed assistant replies scoped to synthesized turn boundaries for older histories", () => {
    const resolved = resolveConversationHistoryResults(
      {
        status: "fulfilled",
        value: {
          conversation_id: "conversation-1",
          title: "Title",
          messages: [
            {
              id: "message-1",
              role: "user",
              content: { text: "Summarize report" },
              iteration: null,
              created_at: "2026-04-18T07:14:52.297999Z",
            },
            {
              id: "message-2",
              role: "assistant",
              content: { text: "Here is the summary for report A." },
              iteration: 1,
              created_at: "2026-04-18T07:14:55.297999Z",
            },
            {
              id: "message-3",
              role: "user",
              content: { text: "Summarize report" },
              iteration: null,
              created_at: "2026-04-18T07:15:02.297999Z",
            },
            {
              id: "message-4",
              role: "assistant",
              content: { text: "Here is the summary for report B." },
              iteration: 2,
              created_at: "2026-04-18T07:15:05.297999Z",
            },
          ],
        },
      },
      {
        status: "fulfilled",
        value: {
          events: [
            {
              type: "turn_complete",
              data: { result: "Here is the summary for report A." },
              timestamp: "2026-04-18T07:14:55.297999Z",
              iteration: 1,
            },
            {
              type: "turn_complete",
              data: { result: "Here is the summary for report B." },
              timestamp: "2026-04-18T07:15:05.297999Z",
              iteration: 2,
            },
          ],
        },
      },
      {
        status: "fulfilled",
        value: { artifacts: [] },
      },
    );

    const transcript = buildConversationTranscriptState(
      resolved.messages,
      resolved.events,
      [],
    );

    expect(transcript.effectiveEvents.map((event) => event.type)).toEqual([
      "turn_start",
      "turn_complete",
      "turn_start",
      "turn_complete",
    ]);
    expect(transcript.messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      "user:Summarize report",
      "assistant:Here is the summary for report A.",
      "user:Summarize report",
      "assistant:Here is the summary for report B.",
    ]);
  });
});
