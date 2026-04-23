import { describe, expect, it } from "@jest/globals";
import type { ChatMessage } from "@/shared/types";
import {
  mergeConversationMessages,
  reconcileOptimisticConversationMessages,
  toHistoryChatMessage,
} from "./message-identity";

describe("mergeConversationMessages", () => {
  it("reconciles optimistic and persisted messages into one entry", () => {
    const optimistic: ChatMessage = {
      messageId: "optimistic:c1:1",
      role: "user",
      content: "hello",
      timestamp: 10_000,
      source: "optimistic",
      attachments: [{ name: "a.txt", size: 1, type: "text/plain" }],
    };
    const persisted: ChatMessage = {
      messageId: "history:m1",
      role: "user",
      content: "hello",
      timestamp: 10_100,
      source: "history",
    };

    const merged = mergeConversationMessages([optimistic], [persisted]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.messageId).toBe("history:m1");
    expect(merged[0]?.attachments).toEqual(optimistic.attachments);
  });

  it("updates in place when message ids match", () => {
    const early: ChatMessage = {
      messageId: "event:turn:1:assistant:0",
      role: "assistant",
      content: "Hello",
      timestamp: 20_000,
      source: "event",
    };
    const updated: ChatMessage = {
      messageId: "event:turn:1:assistant:0",
      role: "assistant",
      content: "Hello world",
      timestamp: 20_200,
      source: "event",
      imageArtifactIds: ["art-1"],
    };

    const merged = mergeConversationMessages([early], [updated]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe("Hello world");
    expect(merged[0]?.imageArtifactIds).toEqual(["art-1"]);
    expect(merged[0]?.timestamp).toBe(20_000);
  });

  it("preserves collection insertion order over timestamp order", () => {
    const first: ChatMessage = {
      messageId: "event:first",
      role: "assistant",
      content: "step one",
      timestamp: 20_000,
      source: "event",
    };
    const second: ChatMessage = {
      messageId: "event:second",
      role: "assistant",
      content: "step two",
      timestamp: 10_000,
      source: "event",
    };

    const merged = mergeConversationMessages([first], [second]);
    expect(merged.map((message) => message.messageId)).toEqual([
      "event:first",
      "event:second",
    ]);
  });

  it("normalizes persisted assistant think tags into thinkingContent", () => {
    const message = toHistoryChatMessage({
      id: "history-1",
      role: "assistant",
      content: { text: "<think>internal notes</think>\n\nVisible answer" },
      iteration: 1,
      created_at: "2026-04-18T07:14:52.297999Z",
    });

    expect(message.content).toBe("Visible answer");
    expect(message.thinkingContent).toBe("internal notes");
  });
});

describe("reconcileOptimisticConversationMessages", () => {
  it("keeps a single user bubble before the assistant once the transcript user arrives", () => {
    const transcript: ChatMessage[] = [
      {
        messageId: "event-turn:1:user:0",
        role: "user",
        content: "有什么不能做的?",
        timestamp: 20_000,
        source: "event",
      },
      {
        messageId: "event-turn:1:assistant:0",
        role: "assistant",
        content: "以下是一些我做不了的事情：",
        timestamp: 20_100,
        source: "event",
      },
    ];
    const local: ChatMessage[] = [
      {
        messageId: "optimistic:c1:1",
        role: "user",
        content: "有什么不能做的?",
        timestamp: 19_500,
        source: "optimistic",
      },
    ];

    const merged = reconcileOptimisticConversationMessages(
      transcript,
      local,
      new Map([["optimistic:c1:1", { transcriptUserCountAtSend: 0, transcriptMessageCountAtSend: 0 }]]),
    );

    expect(merged.map((message) => message.content)).toEqual([
      "有什么不能做的?",
      "以下是一些我做不了的事情：",
    ]);
    expect(merged[0]?.messageId).toBe("event-turn:1:user:0");
  });

  it("preserves optimistic attachments when the transcript user has none", () => {
    const transcript: ChatMessage[] = [
      {
        messageId: "event-turn:1:user:0",
        role: "user",
        content: "inspect this",
        timestamp: 20_000,
        source: "event",
      },
    ];
    const local: ChatMessage[] = [
      {
        messageId: "optimistic:c1:1",
        role: "user",
        content: "inspect this",
        timestamp: 19_500,
        source: "optimistic",
        attachments: [{ name: "report.csv", size: 42, type: "text/csv" }],
      },
    ];

    const merged = reconcileOptimisticConversationMessages(
      transcript,
      local,
      new Map([["optimistic:c1:1", { transcriptUserCountAtSend: 0, transcriptMessageCountAtSend: 0 }]]),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.attachments).toEqual([
      { name: "report.csv", size: 42, type: "text/csv" },
    ]);
  });

  it("does not match a new optimistic user to an older identical transcript user", () => {
    const transcript: ChatMessage[] = [
      {
        messageId: "event-turn:1:user:0",
        role: "user",
        content: "hello",
        timestamp: 10_000,
        source: "event",
      },
      {
        messageId: "event-turn:1:assistant:0",
        role: "assistant",
        content: "first response",
        timestamp: 10_100,
        source: "event",
      },
    ];
    const local: ChatMessage[] = [
      {
        messageId: "optimistic:c1:2",
        role: "user",
        content: "hello",
        timestamp: 20_000,
        source: "optimistic",
      },
    ];

    const merged = reconcileOptimisticConversationMessages(
      transcript,
      local,
      new Map([["optimistic:c1:2", { transcriptUserCountAtSend: 1, transcriptMessageCountAtSend: 2 }]]),
    );

    expect(merged.map((message) => message.messageId)).toEqual([
      "event-turn:1:user:0",
      "event-turn:1:assistant:0",
      "optimistic:c1:2",
    ]);
  });

  it("reconciles repeated identical prompts in send order without collapsing turns", () => {
    const transcript: ChatMessage[] = [
      {
        messageId: "event-turn:1:user:0",
        role: "user",
        content: "hello",
        timestamp: 10_000,
        source: "event",
      },
      {
        messageId: "event-turn:1:assistant:0",
        role: "assistant",
        content: "first response",
        timestamp: 10_100,
        source: "event",
      },
      {
        messageId: "event-turn:2:user:0",
        role: "user",
        content: "hello",
        timestamp: 20_000,
        source: "event",
      },
      {
        messageId: "event-turn:2:assistant:0",
        role: "assistant",
        content: "second response",
        timestamp: 20_100,
        source: "event",
      },
    ];
    const local: ChatMessage[] = [
      {
        messageId: "optimistic:c1:1",
        role: "user",
        content: "hello",
        timestamp: 9_900,
        source: "optimistic",
      },
      {
        messageId: "optimistic:c1:2",
        role: "user",
        content: "hello",
        timestamp: 19_900,
        source: "optimistic",
      },
    ];

    const merged = reconcileOptimisticConversationMessages(
      transcript,
      local,
      new Map([
        ["optimistic:c1:1", { transcriptUserCountAtSend: 0, transcriptMessageCountAtSend: 0 }],
        ["optimistic:c1:2", { transcriptUserCountAtSend: 1, transcriptMessageCountAtSend: 2 }],
      ]),
    );

    expect(merged.map((message) => message.messageId)).toEqual([
      "event-turn:1:user:0",
      "event-turn:1:assistant:0",
      "event-turn:2:user:0",
      "event-turn:2:assistant:0",
    ]);
  });

  it("keeps unmatched optimistic assistant errors after the transcript timeline", () => {
    const transcript: ChatMessage[] = [
      {
        messageId: "event-turn:1:user:0",
        role: "user",
        content: "hello",
        timestamp: 10_000,
        source: "event",
      },
    ];
    const local: ChatMessage[] = [
      {
        messageId: "optimistic:c1:1",
        role: "user",
        content: "hello",
        timestamp: 9_900,
        source: "optimistic",
      },
      {
        role: "assistant",
        content: "Error: request failed",
        timestamp: 10_500,
      },
    ];

    const merged = reconcileOptimisticConversationMessages(
      transcript,
      local,
      new Map([["optimistic:c1:1", { transcriptUserCountAtSend: 0, transcriptMessageCountAtSend: 0 }]]),
    );

    expect(merged.map((message) => message.content)).toEqual([
      "hello",
      "Error: request failed",
    ]);
  });

  it("inserts an unmatched optimistic user before assistant transcript messages that arrived after send", () => {
    const transcript: ChatMessage[] = [
      {
        messageId: "event-turn:1:assistant:0",
        role: "assistant",
        content: "streaming reply",
        timestamp: 20_100,
        source: "event",
      },
    ];
    const local: ChatMessage[] = [
      {
        messageId: "optimistic:c1:1",
        role: "user",
        content: "hello",
        timestamp: 20_000,
        source: "optimistic",
      },
    ];

    const merged = reconcileOptimisticConversationMessages(
      transcript,
      local,
      new Map([["optimistic:c1:1", { transcriptUserCountAtSend: 0, transcriptMessageCountAtSend: 0 }]]),
    );

    expect(merged.map((message) => message.content)).toEqual([
      "hello",
      "streaming reply",
    ]);
  });

  it("matches optimistic users against deduped transcript indexes without skipping later user rows", () => {
    const transcript: ChatMessage[] = [
      {
        messageId: "event-turn:1:user:0",
        role: "user",
        content: "hello",
        timestamp: 10_000,
        source: "event",
      },
      {
        messageId: "event-turn:1:assistant:0",
        role: "assistant",
        content: "first response",
        timestamp: 10_100,
        source: "event",
      },
      {
        messageId: "event-turn:2:user:0",
        role: "user",
        content: "follow up",
        timestamp: 20_000,
        source: "event",
      },
    ];
    const local: ChatMessage[] = [
      {
        messageId: "optimistic:c1:1",
        role: "user",
        content: "hello",
        timestamp: 9_900,
        source: "optimistic",
      },
      {
        messageId: "optimistic:c1:2",
        role: "user",
        content: "follow up",
        timestamp: 19_900,
        source: "optimistic",
      },
    ];

    const merged = reconcileOptimisticConversationMessages(
      transcript,
      local,
      new Map([
        ["optimistic:c1:1", { transcriptUserCountAtSend: 0, transcriptMessageCountAtSend: 0 }],
        ["optimistic:c1:2", { transcriptUserCountAtSend: 1, transcriptMessageCountAtSend: 2 }],
      ]),
    );

    expect(merged.map((message) => message.messageId)).toEqual([
      "event-turn:1:user:0",
      "event-turn:1:assistant:0",
      "event-turn:2:user:0",
    ]);
  });
});
