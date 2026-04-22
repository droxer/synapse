import { describe, expect, it } from "@jest/globals";
import {
  isConversationHistoryLoading,
  isConversationNotFoundError,
  normalizeHistoryEvent,
  normalizeHistoryMessage,
  normalizeHistoryArtifact,
  resolveConversationHistoryResults,
} from "./use-conversation-history";

describe("isConversationHistoryLoading", () => {
  it("treats a newly selected conversation as loading before the fetch effect settles", () => {
    expect(
      isConversationHistoryLoading("conversation-1", null, false),
    ).toBe(true);
  });

  it("stays loading while an in-flight history request is running", () => {
    expect(
      isConversationHistoryLoading("conversation-1", "conversation-1", true),
    ).toBe(true);
  });

  it("stops loading once the selected conversation has finished loading", () => {
    expect(
      isConversationHistoryLoading("conversation-1", "conversation-1", false),
    ).toBe(false);
  });

  it("does not report loading when no conversation is selected", () => {
    expect(isConversationHistoryLoading(null, null, false)).toBe(false);
  });

  it("normalizes persisted artifacts for the conversation artifact panel", () => {
    expect(normalizeHistoryArtifact({
      id: "artifact-1",
      name: "report.docx",
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 15991,
      created_at: "2026-04-18T07:14:52.297999Z",
      file_path: "/workspace/report.docx",
    })).toEqual({
      id: "artifact-1",
      name: "report.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 15991,
      createdAt: "2026-04-18T07:14:52.297999Z",
      filePath: "/workspace/report.docx",
    });
  });

  it("normalizes persisted user attachments from message content", () => {
    expect(normalizeHistoryMessage({
      id: "message-1",
      role: "user",
      content: {
        text: "inspect this",
        attachments: [{ name: "report.csv", size: 42, type: "text/csv" }],
      },
      created_at: "2026-04-18T07:14:52.297999Z",
    })).toMatchObject({
      role: "user",
      content: "inspect this",
      attachments: [{ name: "report.csv", size: 42, type: "text/csv" }],
    });
  });

  it("keeps newly supported SSE events during history normalization", () => {
    expect(normalizeHistoryEvent({
      type: "preview_available",
      data: { port: 3001, url: "/api/conversations/c1/preview/" },
      timestamp: "2026-04-18T07:14:52.297999Z",
      iteration: null,
    })).toEqual([
      {
        type: "preview_available",
        data: { port: 3001, url: "/api/conversations/c1/preview/" },
        timestamp: new Date("2026-04-18T07:14:52.297999Z").getTime(),
        iteration: null,
      },
    ]);
  });

  it("does not synthesize duplicate turn_start events when persisted history already has them", () => {
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
              content: { text: "hello" },
              iteration: null,
              created_at: "2026-04-18T07:14:52.297999Z",
            },
          ],
        },
      },
      {
        status: "fulfilled",
        value: {
          events: [
            {
              type: "turn_start",
              data: { message: "hello" },
              timestamp: "2026-04-18T07:14:52.297999Z",
              iteration: null,
            },
            {
              type: "turn_complete",
              data: { result: "done" },
              timestamp: "2026-04-18T07:14:54.297999Z",
              iteration: 1,
            },
          ],
        },
      },
      {
        status: "fulfilled",
        value: { artifacts: [] },
      },
    );

    expect(resolved.events.map((event) => event.type)).toEqual([
      "turn_start",
      "turn_complete",
    ]);
  });

  it("synthesizes missing turn_start events from persisted user messages", () => {
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
              content: {
                text: "inspect this",
                attachments: [{ name: "report.csv", size: 42, type: "text/csv" }],
              },
              iteration: null,
              created_at: "2026-04-18T07:14:52.297999Z",
            },
            {
              id: "message-2",
              role: "assistant",
              content: { text: "done" },
              iteration: 1,
              created_at: "2026-04-18T07:14:55.297999Z",
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
              data: { result: "done" },
              timestamp: "2026-04-18T07:14:55.297999Z",
              iteration: 1,
            },
          ],
        },
      },
      {
        status: "fulfilled",
        value: { artifacts: [] },
      },
    );

    expect(resolved.events.map((event) => event.type)).toEqual([
      "turn_start",
      "turn_complete",
    ]);
    expect(resolved.events[0]).toEqual({
      type: "turn_start",
      data: {
        message: "inspect this",
        attachments: [{ name: "report.csv", size: 42, type: "text/csv" }],
      },
      timestamp: new Date("2026-04-18T07:14:52.297999Z").getTime(),
      iteration: null,
    });
  });

  it("backfills only the missing turn boundaries in multi-turn histories", () => {
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
              content: { text: "first ask" },
              iteration: null,
              created_at: "2026-04-18T07:14:52.297999Z",
            },
            {
              id: "message-2",
              role: "assistant",
              content: { text: "First answer" },
              iteration: 1,
              created_at: "2026-04-18T07:14:55.297999Z",
            },
            {
              id: "message-3",
              role: "user",
              content: { text: "second ask" },
              iteration: null,
              created_at: "2026-04-18T07:15:02.297999Z",
            },
            {
              id: "message-4",
              role: "assistant",
              content: { text: "Second answer" },
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
              type: "turn_start",
              data: { message: "first ask" },
              timestamp: "2026-04-18T07:14:52.297999Z",
              iteration: null,
            },
            {
              type: "turn_complete",
              data: { result: "First answer" },
              timestamp: "2026-04-18T07:14:55.297999Z",
              iteration: 1,
            },
            {
              type: "turn_complete",
              data: { result: "Second answer" },
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

    expect(resolved.events.map((event) => [event.type, event.data.message ?? event.data.result])).toEqual([
      ["turn_start", "first ask"],
      ["turn_complete", "First answer"],
      ["turn_start", "second ask"],
      ["turn_complete", "Second answer"],
    ]);
  });

  it("keeps messages and events when artifacts loading fails", () => {
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
              content: { text: "hello" },
              iteration: null,
              created_at: "2026-04-18T07:14:52.297999Z",
            },
          ],
        },
      },
      {
        status: "fulfilled",
        value: {
          events: [
            {
              type: "turn_start",
              data: { message: "hello" },
              timestamp: "2026-04-18T07:14:52.297999Z",
              iteration: null,
            },
          ],
        },
      },
      {
        status: "rejected",
        reason: new Error("Failed to fetch artifacts: 500"),
      },
    );

    expect(resolved.messages).toHaveLength(1);
    expect(resolved.events).toHaveLength(1);
    expect(resolved.artifacts).toEqual([]);
    expect(resolved.missingConversation).toBe(false);
  });

  it("keeps messages when events loading fails", () => {
    const resolved = resolveConversationHistoryResults(
      {
        status: "fulfilled",
        value: {
          conversation_id: "conversation-1",
          title: "Title",
          messages: [
            {
              id: "message-1",
              role: "assistant",
              content: { text: "done" },
              iteration: null,
              created_at: "2026-04-18T07:14:52.297999Z",
            },
          ],
        },
      },
      {
        status: "rejected",
        reason: new Error("Failed to fetch events: 500"),
      },
      {
        status: "fulfilled",
        value: { artifacts: [] },
      },
    );

    expect(resolved.messages).toHaveLength(1);
    expect(resolved.events).toEqual([]);
    expect(resolved.missingConversation).toBe(false);
  });

  it("keeps events when messages loading fails", () => {
    const resolved = resolveConversationHistoryResults(
      {
        status: "rejected",
        reason: new Error("Failed to fetch messages: 500"),
      },
      {
        status: "fulfilled",
        value: {
          events: [
            {
              type: "turn_start",
              data: { message: "hello" },
              timestamp: "2026-04-18T07:14:52.297999Z",
              iteration: null,
            },
          ],
        },
      },
      {
        status: "fulfilled",
        value: { artifacts: [] },
      },
    );

    expect(resolved.messages).toEqual([]);
    expect(resolved.events).toHaveLength(1);
    expect(resolved.missingConversation).toBe(false);
  });

  it("marks the conversation missing on message 404 errors", () => {
    const resolved = resolveConversationHistoryResults(
      {
        status: "rejected",
        reason: new Error("Failed to fetch messages: 404"),
      },
      {
        status: "fulfilled",
        value: { events: [] },
      },
      {
        status: "fulfilled",
        value: { artifacts: [] },
      },
    );

    expect(isConversationNotFoundError(new Error("Failed to fetch messages: 404"))).toBe(true);
    expect(resolved.missingConversation).toBe(true);
  });
});
