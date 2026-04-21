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

  it("merges persisted attachments onto matching event-derived user messages", () => {
    const history: ChatMessage[] = [
      {
        role: "user",
        content: "inspect this",
        timestamp: 100,
        attachments: [{ name: "report.csv", size: 42, type: "text/csv" }],
      },
    ];
    const derived: ChatMessage[] = [
      { role: "user", content: "inspect this", timestamp: 100 },
    ];

    const merged = mergeHistoryWithEventDerivedMessages(history, derived);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.attachments).toEqual([
      { name: "report.csv", size: 42, type: "text/csv" },
    ]);
  });

  it("upgrades a live partial assistant bubble with fuller persisted history content", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Summarize it", timestamp: 100 },
      { role: "assistant", content: "Final answer with the missing ending.", timestamp: 200 },
    ];
    const derived: ChatMessage[] = [
      { role: "user", content: "Summarize it", timestamp: 100 },
      { role: "assistant", content: "Final answer", timestamp: 190 },
    ];

    const merged = mergeHistoryWithEventDerivedMessages(history, derived);

    expect(merged).toHaveLength(2);
    expect(merged[1]?.content).toBe("Final answer with the missing ending.");
  });

  it("keeps distinct assistant segments separate when only the latest segment matches history", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Research", timestamp: 100 },
      { role: "assistant", content: "Finding two with the final detail.", timestamp: 220 },
    ];
    const derived: ChatMessage[] = [
      { role: "user", content: "Research", timestamp: 100 },
      { role: "assistant", content: "Finding", timestamp: 150 },
      { role: "assistant", content: "Finding two", timestamp: 210 },
    ];

    const merged = mergeHistoryWithEventDerivedMessages(history, derived);

    expect(merged.map((message) => message.content)).toEqual([
      "Research",
      "Finding",
      "Finding two with the final detail.",
    ]);
  });
});
