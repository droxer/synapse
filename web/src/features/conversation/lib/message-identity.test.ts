import { describe, expect, it } from "@jest/globals";
import type { ChatMessage } from "@/shared/types";
import { mergeConversationMessages } from "./message-identity";

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
});
