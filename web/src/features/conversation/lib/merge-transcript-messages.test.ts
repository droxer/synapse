import { describe, expect, it } from "@jest/globals";
import { mergeHistoryWithEventDerivedMessages } from "./merge-transcript-messages";
import type { ChatMessage } from "@/shared/types";

describe("mergeHistoryWithEventDerivedMessages", () => {
  it("keeps event-derived segment order when DB only has the final assistant message", () => {
    const t0 = 1_000_000;
    const history: ChatMessage[] = [
      { role: "user", content: "Research X", timestamp: t0 },
      { role: "assistant", content: "Final synthesis.", timestamp: t0 + 30_000 },
    ];
    const derived: ChatMessage[] = [
      { role: "user", content: "Research X", timestamp: t0 },
      { role: "assistant", content: "Finding A", timestamp: t0 + 5_000 },
      { role: "assistant", content: "Finding B", timestamp: t0 + 10_000 },
      { role: "assistant", content: "Final synthesis.", timestamp: t0 + 30_000 },
    ];

    const merged = mergeHistoryWithEventDerivedMessages(history, derived);
    expect(merged.map((m) => m.content)).toEqual([
      "Research X",
      "Finding A",
      "Finding B",
      "Final synthesis.",
    ]);
  });

  it("falls back to history when there are no event-derived messages", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Hi", timestamp: 100 },
      { role: "assistant", content: "Hello", timestamp: 200 },
    ];
    expect(mergeHistoryWithEventDerivedMessages(history, [])).toEqual(history);
  });

  it("inserts orphan DB messages by timestamp when missing from events", () => {
    const derived: ChatMessage[] = [
      { role: "user", content: "Q", timestamp: 100 },
      { role: "assistant", content: "A2", timestamp: 300 },
    ];
    const history: ChatMessage[] = [
      { role: "user", content: "Q", timestamp: 100 },
      { role: "assistant", content: "Legacy only", timestamp: 200 },
      { role: "assistant", content: "A2", timestamp: 300 },
    ];

    const merged = mergeHistoryWithEventDerivedMessages(history, derived);
    expect(merged.map((m) => m.content)).toEqual(["Q", "Legacy only", "A2"]);
  });

  it("preserves the persisted final assistant message when live events were reset after completion", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "输出 WORD 文档格式", timestamp: 100 },
      {
        role: "assistant",
        content: "已成功生成 Palantir Ontology 技术深度研究报告 Word 文档。",
        timestamp: 200,
      },
    ];
    const derived: ChatMessage[] = [
      { role: "user", content: "输出 WORD 文档格式", timestamp: 100 },
    ];

    const merged = mergeHistoryWithEventDerivedMessages(history, derived);
    expect(merged.map((m) => m.content)).toEqual([
      "输出 WORD 文档格式",
      "已成功生成 Palantir Ontology 技术深度研究报告 Word 文档。",
    ]);
  });
});
