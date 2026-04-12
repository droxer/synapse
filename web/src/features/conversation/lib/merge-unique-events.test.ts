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
});
