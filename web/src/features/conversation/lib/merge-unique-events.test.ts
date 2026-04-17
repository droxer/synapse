import { describe, expect, it } from "@jest/globals";
import { mergeUniqueEvents } from "./merge-unique-events";
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
});
