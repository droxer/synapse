import assert from "node:assert/strict";
import test from "node:test";

import { TuiController } from "../src/controller.ts";
import { renderScreen, resolveLayoutMode } from "../src/render.ts";
import type { ConversationEvent } from "../src/types.ts";

class FakeApiClient {
  async listConversations() {
    return [];
  }

  async createConversation(): Promise<string> {
    return "conv-created";
  }

  async sendMessage(): Promise<void> {
    return Promise.resolve();
  }

  async fetchMessages() {
    return { title: "History", messages: [] };
  }

  async fetchEvents(): Promise<ConversationEvent[]> {
    return [];
  }

  async *streamEventsOnce(): AsyncIterable<ConversationEvent> {
    yield* [];
  }

  async respondToPrompt(): Promise<void> {
    return Promise.resolve();
  }

  async cancelTurn(): Promise<void> {
    return Promise.resolve();
  }

  async retryTurn(): Promise<void> {
    return Promise.resolve();
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}

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

function renderForTest(controller: TuiController, width = 140, height = 32): string {
  return renderScreen(
    {
      controller,
      sidebarIndex: 0,
      focus: "composer",
      inputBuffer: "",
      cursorIndex: 0,
      transcriptScroll: 0,
      activityScroll: 0,
    },
    width,
    height,
  );
}

test("render shows streaming assistant draft with thinking and text deltas", () => {
  const controller = new TuiController({ apiClient: new FakeApiClient() });
  controller.store.applyEvent(createEvent("turn_start", { message: "hello" }, 1000));
  controller.store.applyEvent(
    createEvent(
      "thinking",
      { thinking: "## Plan\n- inspect\n- answer" },
      1100,
    ),
  );
  controller.store.applyEvent(
    createEvent(
      "text_delta",
      { delta: "### Result\n- item one\n- item two\n[docs](https://example.com)" },
      1200,
    ),
  );

  const screen = renderForTest(controller);

  assert.match(screen, /\[Live Turn\]/);
  assert.match(screen, /\[Thinking\]/);
  assert.match(screen, /\[Streaming Response\]/);
  assert.match(screen, /## Plan/);
  assert.match(screen, /- inspect/);
  assert.match(screen, /### Result/);
  assert.match(screen, /docs <https:\/\/example.com>/);
});

test("render shows ask_user inline in transcript-first mode", () => {
  const controller = new TuiController({ apiClient: new FakeApiClient() });
  controller.store.applyEvent(createEvent("turn_start", { message: "need input" }, 1000));
  controller.store.applyEvent(
    createEvent(
      "ask_user",
      {
        request_id: "req-1",
        question: "Choose a path",
        options: [{ label: "A", value: "a" }],
      },
      1100,
    ),
  );

  const screen = renderForTest(controller);

  assert.match(screen, /\[Agent Needs Input\]/);
  assert.match(screen, /Choose a path/);
  assert.match(screen, /1\. A/);
});

test("render keeps turn terminal states readable", () => {
  const controller = new TuiController({ apiClient: new FakeApiClient() });
  controller.store.applyEvent(createEvent("turn_start", { message: "boom" }, 1000));
  controller.store.applyEvent(createEvent("task_error", { error: "failed hard" }, 1100));
  controller.store.applyEvent(createEvent("turn_cancelled", {}, 1200));

  const screen = renderForTest(controller);

  assert.match(screen, /Error: failed hard/);
  assert.match(screen, /Turn cancelled\./);
  assert.match(screen, /System @/);
});

test("render formats markdown in transcript entries", () => {
  const controller = new TuiController({ apiClient: new FakeApiClient() });
  controller.store.view.transcript.push({
    role: "assistant",
    content: [
      "# Title",
      "",
      "- one",
      "- two",
      "",
      "> quoted line",
      "",
      "Inline [link](https://example.com) and `code`.",
      "",
      "```ts",
      "const value = 1;",
      "console.log(value);",
      "```",
    ].join("\n"),
    timestampMs: 1000,
    thinking: "",
  });

  const screen = renderForTest(controller);

  assert.match(screen, /# Title/);
  assert.match(screen, /- one/);
  assert.match(screen, /> quoted line/);
  assert.match(screen, /link <https:\/\/example.com>/);
  assert.match(screen, /'code'/);
  assert.match(screen, /\[code:ts\]/);
  assert.match(screen, /const value = 1;/);
});

test("render uses adaptive layout modes", () => {
  assert.equal(resolveLayoutMode(160), "wide");
  assert.equal(resolveLayoutMode(120), "stacked");
  assert.equal(resolveLayoutMode(90), "narrow");
});
