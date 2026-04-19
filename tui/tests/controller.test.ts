import assert from "node:assert/strict";
import test from "node:test";

import { TuiController } from "../src/controller.ts";
import type {
  ConversationEvent,
  ConversationSummary,
  HistoryMessage,
} from "../src/types.ts";

function createEvent(
  type: string,
  data: Record<string, unknown>,
  timestampMs: number,
): ConversationEvent {
  return {
    type,
    data,
    timestampMs,
    iteration: null,
  };
}

class FakeApiClient {
  recent: ConversationSummary[] = [];
  histories = new Map<
    string,
    { title: string; messages: HistoryMessage[]; events: ConversationEvent[] }
  >();
  streams = new Map<string, ConversationEvent[][]>();
  createdMessages: string[] = [];
  sentMessages: Array<{ conversationId: string; message: string }> = [];
  responses: Array<{ conversationId: string; requestId: string; responseText: string }> = [];
  cancelled: string[] = [];
  retried: string[] = [];

  async listConversations(): Promise<ConversationSummary[]> {
    return [...this.recent];
  }

  async createConversation(message: string): Promise<string> {
    this.createdMessages.push(message);
    const conversationId = "conv-created";
    this.recent = [
      {
        id: conversationId,
        title: "Created",
        createdAt: "2026-04-19T10:00:00+00:00",
        updatedAt: "2026-04-19T10:01:00+00:00",
      },
    ];
    this.histories.set(conversationId, {
      title: "Created",
      messages: [],
      events: [],
    });
    return conversationId;
  }

  async sendMessage(conversationId: string, message: string): Promise<void> {
    this.sentMessages.push({ conversationId, message });
  }

  async fetchMessages(
    conversationId: string,
  ): Promise<{ title: string; messages: HistoryMessage[] }> {
    const item = this.histories.get(conversationId);
    if (!item) {
      throw new Error(`Unknown conversation ${conversationId}`);
    }
    return {
      title: item.title,
      messages: [...item.messages],
    };
  }

  async fetchEvents(conversationId: string): Promise<ConversationEvent[]> {
    return [...(this.histories.get(conversationId)?.events ?? [])];
  }

  async *streamEventsOnce(conversationId: string): AsyncIterable<ConversationEvent> {
    const batches = this.streams.get(conversationId) ?? [];
    const batch = batches.shift() ?? [];
    this.streams.set(conversationId, batches);
    for (const event of batch) {
      yield event;
    }
  }

  async respondToPrompt(
    conversationId: string,
    requestId: string,
    responseText: string,
  ): Promise<void> {
    this.responses.push({ conversationId, requestId, responseText });
  }

  async cancelTurn(conversationId: string): Promise<void> {
    this.cancelled.push(conversationId);
  }

  async retryTurn(conversationId: string): Promise<void> {
    this.retried.push(conversationId);
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

test("controller boots into empty state", async () => {
  const api = new FakeApiClient();
  const controller = new TuiController({ apiClient: api });

  await controller.initialize();

  assert.equal(controller.store.view.conversationId, null);
  assert.deepEqual(controller.store.view.transcript, []);
  await controller.close();
});

test("controller preserves startup error when recent conversations fail", async () => {
  const api = new FakeApiClient();
  api.listConversations = async () => {
    throw new Error("fetch failed");
  };
  const controller = new TuiController({ apiClient: api });

  await controller.initialize();

  assert.match(
    controller.store.view.transcript.at(-1)?.content ?? "",
    /Failed to load recent conversations: fetch failed/,
  );
  await controller.close();
});

test("controller creates conversation and streams assistant output", async () => {
  const api = new FakeApiClient();
  api.streams.set("conv-created", [[
    createEvent("turn_start", { message: "hello" }, 1000),
    createEvent("text_delta", { delta: "Hi there" }, 1100),
    createEvent("turn_complete", { result: "" }, 1200),
  ]]);

  const controller = new TuiController({ apiClient: api });
  await controller.initialize();
  await controller.submitInput("hello");
  await settle();
  await settle();

  assert.deepEqual(api.createdMessages, ["hello"]);
  assert.equal(controller.store.view.conversationId, "conv-created");
  assert.deepEqual(
    controller.store.view.transcript.map((entry) => entry.role),
    ["user", "assistant"],
  );
  assert.equal(controller.store.view.transcript.at(-1)?.content, "Hi there");
  await controller.close();
});

test("controller loads existing conversation history", async () => {
  const api = new FakeApiClient();
  api.recent = [
    {
      id: "conv-1",
      title: "Existing",
      createdAt: "2026-04-19T10:00:00+00:00",
      updatedAt: "2026-04-19T10:01:00+00:00",
    },
  ];
  api.histories.set("conv-1", {
    title: "Existing",
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "hello",
        iteration: null,
        timestampMs: 1000,
      },
      {
        id: "msg-2",
        role: "assistant",
        content: "world",
        iteration: null,
        timestampMs: 1100,
      },
    ],
    events: [],
  });

  const controller = new TuiController({ apiClient: api });
  await controller.initialize();
  await controller.openConversation("conv-1");

  assert.equal(controller.store.view.conversationId, "conv-1");
  assert.deepEqual(
    controller.store.view.transcript.map((entry) => entry.content),
    ["hello", "world"],
  );
  await controller.close();
});

test("controller switches to pending prompt mode", async () => {
  const api = new FakeApiClient();
  api.streams.set("conv-created", [[
    createEvent("turn_start", { message: "need input" }, 1000),
    createEvent(
      "ask_user",
      { request_id: "req-1", question: "Choose a path" },
      1100,
    ),
  ]]);

  const controller = new TuiController({ apiClient: api });
  await controller.initialize();
  await controller.submitInput("need input");
  await settle();
  await settle();

  assert.equal(controller.store.view.pendingAsk?.requestId, "req-1");
  await controller.submitInput("path a");
  assert.deepEqual(api.responses, [
    {
      conversationId: "conv-created",
      requestId: "req-1",
      responseText: "path a",
    },
  ]);
  await controller.close();
});

test("controller shows terminal error states without crashing", async () => {
  const api = new FakeApiClient();
  api.streams.set("conv-created", [[
    createEvent("turn_start", { message: "boom" }, 1000),
    createEvent("task_error", { error: "failed hard" }, 1100),
  ]]);

  const controller = new TuiController({ apiClient: api });
  await controller.initialize();
  await controller.submitInput("boom");
  await settle();
  await settle();

  assert.equal(controller.store.view.turnStatus, "error");
  assert.match(
    controller.store.view.transcript.at(-1)?.content ?? "",
    /failed hard/,
  );
  await controller.close();
});
