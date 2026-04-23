import { describe, expect, it } from "@jest/globals";
import { mergeUniqueEvents } from "./merge-unique-events";
import { buildConversationTranscriptState } from "./build-conversation-transcript";
import { normalizeHistoryEvent } from "../hooks/use-conversation-history";
import { parseSSEEvent } from "@/shared/hooks/use-sse";
import type { AgentEvent } from "@/shared/types";

describe("mergeUniqueEvents", () => {
  it("keeps history order then live order without timestamp resorting", () => {
    const history: AgentEvent[] = [
      { type: "turn_start", data: { message: "hi" }, timestamp: 200, iteration: null },
    ];
    const live: AgentEvent[] = [
      { type: "text_delta", data: { delta: "a" }, timestamp: 100, iteration: 1 },
      { type: "llm_response", data: { text: "done" }, timestamp: 150, iteration: 1 },
    ];

    const merged = mergeUniqueEvents(history, live);
    expect(merged.map((e) => e.type)).toEqual([
      "turn_start",
      "text_delta",
      "llm_response",
    ]);
  });

  it("dedupes identical live events against history", () => {
    const dup: AgentEvent = {
      type: "llm_response",
      data: { text: "same" },
      timestamp: 1,
      iteration: 1,
    };
    const merged = mergeUniqueEvents([dup], [dup]);
    expect(merged).toHaveLength(1);
  });

  it("dedupes replayed tool events even when timestamps drift", () => {
    const history: AgentEvent[] = [
      {
        type: "tool_call",
        data: { tool_id: "tool-1", tool_name: "web_search", tool_input: { query: "deep search" } },
        timestamp: 100,
        iteration: 1,
      },
      {
        type: "tool_result",
        data: {
          tool_id: "tool-1",
          output: { query: "deep search", results: [{ title: "A", url: "https://example.com" }] },
          success: true,
        },
        timestamp: 150,
        iteration: 1,
      },
    ];
    const live: AgentEvent[] = [
      {
        type: "tool_call",
        data: { tool_id: "tool-1", tool_name: "web_search", tool_input: { query: "deep search" } },
        timestamp: 101,
        iteration: 1,
      },
      {
        type: "tool_result",
        data: {
          tool_id: "tool-1",
          output: { query: "deep search", results: [{ title: "A", url: "https://example.com" }] },
          success: true,
        },
        timestamp: 151,
        iteration: 1,
      },
    ];

    const merged = mergeUniqueEvents(history, live);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.type)).toEqual(["tool_call", "tool_result"]);
  });

  it("keeps repeated text_delta chunks when chunk identity differs", () => {
    const live: AgentEvent[] = [
      {
        type: "text_delta",
        data: { delta: "A", sequence: 1, stream_id: "s1" },
        timestamp: 100,
        iteration: 1,
      },
      {
        type: "text_delta",
        data: { delta: "A", sequence: 2, stream_id: "s1" },
        timestamp: 100,
        iteration: 1,
      },
    ];

    const merged = mergeUniqueEvents([], live);
    expect(merged).toHaveLength(2);
    expect(merged.map((event) => event.data)).toEqual([
      { delta: "A", sequence: 1, stream_id: "s1" },
      { delta: "A", sequence: 2, stream_id: "s1" },
    ]);
  });

  it("dedupes history and live turn events when only their timestamps drift slightly", () => {
    const history: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "hello" },
        timestamp: 1_000,
        iteration: null,
      },
      {
        type: "turn_complete",
        data: { result: "done" },
        timestamp: 3_000,
        iteration: 1,
      },
    ];
    const live: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "hello" },
        timestamp: 1_250,
        iteration: null,
      },
      {
        type: "turn_complete",
        data: { result: "done" },
        timestamp: 3_180,
        iteration: 1,
      },
    ];

    const merged = mergeUniqueEvents(history, live);

    expect(merged).toHaveLength(2);
    expect(merged.map((event) => event.type)).toEqual([
      "turn_start",
      "turn_complete",
    ]);
  });

  it("keeps one user and one assistant message when drifted history events overlap with live SSE", () => {
    const historyEvents: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "hello" },
        timestamp: 1_000,
        iteration: null,
      },
      {
        type: "turn_complete",
        data: { result: "done" },
        timestamp: 3_000,
        iteration: 1,
      },
    ];
    const liveEvents: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "hello" },
        timestamp: 1_150,
        iteration: null,
      },
      {
        type: "turn_complete",
        data: { result: "done" },
        timestamp: 3_120,
        iteration: 1,
      },
    ];

    const transcript = buildConversationTranscriptState([], historyEvents, liveEvents);

    expect(transcript.messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      "user:hello",
      "assistant:done",
    ]);
  });

  it("dedupes history and live turn events even when live SSE normalization adds optional undefined keys", () => {
    const historyEvents = [
      ...normalizeHistoryEvent({
        type: "turn_start",
        data: { message: "hello" },
        timestamp: "2026-04-18T07:14:52.297999Z",
        iteration: null,
      }),
      ...normalizeHistoryEvent({
        type: "turn_complete",
        data: { result: "done" },
        timestamp: "2026-04-18T07:14:55.297999Z",
        iteration: 1,
      }),
    ];

    const liveEvents = [
      parseSSEEvent(JSON.stringify({
        event_type: "turn_start",
        data: { message: "hello" },
        timestamp: new Date("2026-04-18T07:14:52.297999Z").getTime(),
        iteration: null,
      }), "turn_start"),
      parseSSEEvent(JSON.stringify({
        event_type: "turn_complete",
        data: { result: "done" },
        timestamp: new Date("2026-04-18T07:14:55.297999Z").getTime(),
        iteration: 1,
      }), "turn_complete"),
    ].filter((event): event is AgentEvent => event !== null);

    const transcript = buildConversationTranscriptState([], historyEvents, liveEvents);

    expect(transcript.effectiveEvents).toHaveLength(2);
    expect(transcript.messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      "user:hello",
      "assistant:done",
    ]);
  });

  it("dedupes turn_start replay when live SSE carries orchestration metadata", () => {
    const history: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "hello", attachments: [{ name: "report.csv", size: 42, type: "text/csv" }] },
        timestamp: 1_000,
        iteration: null,
      },
    ];
    const live: AgentEvent[] = [
      {
        type: "turn_start",
        data: {
          message: "hello",
          attachments: [{ name: "report.csv", size: 42, type: "text/csv" }],
          orchestrator_mode: "planner",
          execution_shape: "parallel",
          execution_rationale: "needs multiple workers",
        },
        timestamp: 1_000,
        iteration: null,
      },
    ];

    const merged = mergeUniqueEvents(history, live);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.type).toBe("turn_start");
  });

  it("keeps separate live turns when identical prompts arrive within the duplicate window", () => {
    const live: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "hello" },
        timestamp: 1_000,
        iteration: null,
      },
      {
        type: "turn_complete",
        data: { result: "first answer" },
        timestamp: 1_800,
        iteration: 1,
      },
      {
        type: "turn_start",
        data: { message: "hello" },
        timestamp: 2_400,
        iteration: null,
      },
      {
        type: "turn_complete",
        data: { result: "second answer" },
        timestamp: 3_200,
        iteration: 2,
      },
    ];

    const transcript = buildConversationTranscriptState([], [], live);

    expect(transcript.effectiveEvents.map((event) => event.type)).toEqual([
      "turn_start",
      "turn_complete",
      "turn_start",
      "turn_complete",
    ]);
    expect(transcript.messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      "user:hello",
      "assistant:first answer",
      "user:hello",
      "assistant:second answer",
    ]);
  });

  it("dedupes turn_complete replay when refetched history only differs in transport metadata", () => {
    const history: AgentEvent[] = [
      {
        type: "turn_complete",
        data: { result: "Final answer", artifact_ids: ["artifact-1"] },
        timestamp: 3_000,
        iteration: 1,
      },
    ];
    const live: AgentEvent[] = [
      {
        type: "turn_complete",
        data: { result: " Final   answer " },
        timestamp: 3_000,
        iteration: 1,
      },
    ];

    const merged = mergeUniqueEvents(history, live);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.type).toBe("turn_complete");
  });
});
