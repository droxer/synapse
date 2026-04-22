import { describe, expect, it } from "@jest/globals";
import type { ChatMessage } from "@/shared/types";
import { buildChannelChatMessages } from "./ChannelChatView";

describe("buildChannelChatMessages", () => {
  it("preserves transcript order instead of re-sorting by timestamp", () => {
    const transcript: ChatMessage[] = [
      { role: "assistant", content: "step one", timestamp: 200, source: "event" },
      { role: "assistant", content: "step two", timestamp: 100, source: "event" },
    ];

    const merged = buildChannelChatMessages(transcript, []);
    expect(merged.map((message) => message.content)).toEqual(["step one", "step two"]);
  });

  it("keeps intentional repeated pending messages when they are far apart", () => {
    const transcript: ChatMessage[] = [
      { role: "user", content: "ok", timestamp: 10_000, source: "event" },
    ];
    const pending: ChatMessage[] = [
      { role: "user", content: "ok", timestamp: 45_000, source: "optimistic" },
    ];

    const merged = buildChannelChatMessages(transcript, pending);
    expect(merged.map((message) => message.timestamp)).toEqual([10_000, 45_000]);
  });

  it("drops only near-duplicate optimistic rows that already landed in transcript", () => {
    const transcript: ChatMessage[] = [
      { role: "user", content: "hello", timestamp: 10_000, source: "event" },
      { role: "assistant", content: "hi", timestamp: 10_100, source: "event" },
    ];
    const pending: ChatMessage[] = [
      { role: "user", content: "hello", timestamp: 10_200, source: "optimistic" },
    ];

    const merged = buildChannelChatMessages(transcript, pending);
    expect(merged).toHaveLength(2);
    expect(merged.map((message) => message.content)).toEqual(["hello", "hi"]);
  });
});
