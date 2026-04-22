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

  it("collapses duplicate persisted assistant rows onto one event-derived reply after refresh", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Summarize it", timestamp: 100, messageId: "history:u1" },
      {
        role: "assistant",
        content: "Final answer",
        timestamp: 190,
        messageId: "history:a1",
        source: "history",
      },
      {
        role: "assistant",
        content: "Final answer with the missing ending.",
        timestamp: 200,
        messageId: "history:a2",
        source: "history",
      },
    ];
    const derived: ChatMessage[] = [
      {
        role: "user",
        content: "Summarize it",
        timestamp: 100,
        messageId: "event-turn:1:user:0",
        source: "event",
        turnId: "event-turn:1",
      },
      {
        role: "assistant",
        content: "Final answer",
        timestamp: 190,
        messageId: "event-turn:1:assistant:0",
        source: "event",
        turnId: "event-turn:1",
      },
    ];

    const merged = mergeHistoryWithEventDerivedMessages(history, derived);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.messageId).toBe("event-turn:1:user:0");
    expect(merged[1]?.messageId).toBe("event-turn:1:assistant:0");
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

  it("dedupes user and assistant DB rows to live event rows when persisted timestamps are far from event times (e.g. after turn_complete refetch)", () => {
    const tEventUser = 1_000_000;
    const tEventAsst = tEventUser + 5_000;
    const tHistory = tEventUser + 600_000;

    const derived: ChatMessage[] = [
      {
        messageId: "event-turn:1:user:0",
        role: "user",
        content: "compare A and B",
        timestamp: tEventUser,
        source: "event",
        turnId: "event-turn:1",
      },
      {
        messageId: "event-turn:1:assistant:0",
        role: "assistant",
        content: "Full answer",
        timestamp: tEventAsst,
        source: "event",
        turnId: "event-turn:1",
      },
    ];
    const history: ChatMessage[] = [
      {
        messageId: "history:u1",
        role: "user",
        content: "compare A and B",
        timestamp: tHistory,
        source: "history",
      },
      {
        messageId: "history:a1",
        role: "assistant",
        content: "Full answer",
        timestamp: tHistory + 5_000,
        source: "history",
      },
    ];

    const merged = mergeHistoryWithEventDerivedMessages(history, derived);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.content)).toEqual(["compare A and B", "Full answer"]);
    expect(merged[0]?.messageId).toBe("event-turn:1:user:0");
    expect(merged[1]?.messageId).toBe("event-turn:1:assistant:0");
  });

  it("upgrades a persisted final assistant row onto the same turn's partial event row even when refresh timestamps drift far apart", () => {
    const tEventUser = 1_000_000;
    const tEventAsst = tEventUser + 5_000;
    const tHistory = tEventUser + 600_000;

    const derived: ChatMessage[] = [
      {
        messageId: "event-turn:1:user:0",
        role: "user",
        content: "summarize the report",
        timestamp: tEventUser,
        source: "event",
        turnId: "event-turn:1",
      },
      {
        messageId: "event-turn:1:assistant:0",
        role: "assistant",
        content: "Final summary",
        timestamp: tEventAsst,
        source: "event",
        turnId: "event-turn:1",
      },
    ];
    const history: ChatMessage[] = [
      {
        messageId: "history:u1",
        role: "user",
        content: "summarize the report",
        timestamp: tHistory,
        source: "history",
      },
      {
        messageId: "history:a1",
        role: "assistant",
        content: "Final summary with appendix and citations.",
        timestamp: tHistory + 5_000,
        source: "history",
      },
    ];

    const merged = mergeHistoryWithEventDerivedMessages(history, derived);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.messageId).toBe("event-turn:1:user:0");
    expect(merged[1]?.messageId).toBe("event-turn:1:assistant:0");
    expect(merged[1]?.content).toBe("Final summary with appendix and citations.");
  });

  it("does not merge a new turn’s persisted full reply into the previous turn’s assistant when the new text extends the same opening as the old reply", () => {
    // Prior turn and new turn can share a common preface; the final persisted row
    // must be a superset of that preface. Old logic preferred the longest *prefix
    // overlap* and could attach the new DB row to the *previous* assistant bubble.
    const priorAssistant = "常见开篇：同一段引导文字。";
    const turn2StreamHead = "常见开篇：同一段引导文字。" + "第二问的正文前段与表格开始。";
    const fullNew =
      "常见开篇：同一段引导文字。" + "第二问的正文前段与表格开始。" + " … 5. 关键差异表 … 结论。";
    const tUser1 = 1_000_000;
    const tAsst1 = tUser1 + 20_000;
    const tUser2 = tAsst1 + 60_000;
    const tAsst2Stream = tUser2 + 2_000;

    const history: ChatMessage[] = [
      { role: "user", content: "First question", timestamp: tUser1, messageId: "history:u1" },
      {
        messageId: "history:a1",
        role: "assistant",
        content: priorAssistant,
        timestamp: tAsst1,
        source: "history",
      },
      { role: "user", content: "Second question", timestamp: tUser2, messageId: "history:u2" },
      {
        messageId: "history:a2",
        role: "assistant",
        content: fullNew,
        timestamp: tAsst2Stream + 5_000,
        source: "history",
      },
    ];

    const derived: ChatMessage[] = [
      { role: "user", content: "First question", timestamp: tUser1, source: "event", turnId: "event-turn:1" },
      {
        messageId: "event-turn:1:assistant:0",
        role: "assistant",
        content: priorAssistant,
        timestamp: tAsst1,
        source: "event",
        turnId: "event-turn:1",
      },
      { role: "user", content: "Second question", timestamp: tUser2, source: "event", turnId: "event-turn:2" },
      {
        messageId: "event-turn:2:assistant:0",
        role: "assistant",
        content: turn2StreamHead,
        timestamp: tAsst2Stream,
        source: "event",
        turnId: "event-turn:2",
      },
    ];

    const merged = mergeHistoryWithEventDerivedMessages(history, derived);

    expect(merged[1]?.content).toBe(priorAssistant);
    expect(merged[3]?.content).toBe(fullNew);
  });
});
