import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { TuiController } from "../src/controller.ts";
import { TerminalTuiApp } from "../src/terminal-app.ts";
import type { ConversationEvent, ConversationSummary, HistoryMessage } from "../src/types.ts";

class FakeApiClient {
  recent: ConversationSummary[] = [];
  histories = new Map<
    string,
    { title: string; messages: HistoryMessage[]; events: ConversationEvent[] }
  >();
  createdMessages: string[] = [];
  cancelled: string[] = [];
  retried: string[] = [];

  async listConversations(): Promise<ConversationSummary[]> {
    return [...this.recent];
  }

  async createConversation(message: string): Promise<string> {
    this.createdMessages.push(message);
    return "conv-created";
  }

  async sendMessage(): Promise<void> {
    return Promise.resolve();
  }

  async fetchMessages(
    conversationId: string,
  ): Promise<{ title: string; messages: HistoryMessage[] }> {
    const history = this.histories.get(conversationId);
    if (!history) {
      throw new Error(`Unknown conversation ${conversationId}`);
    }
    return {
      title: history.title,
      messages: [...history.messages],
    };
  }

  async fetchEvents(conversationId: string): Promise<ConversationEvent[]> {
    return [...(this.histories.get(conversationId)?.events ?? [])];
  }

  async *streamEventsOnce(): AsyncIterable<ConversationEvent> {
    yield* [];
  }

  async respondToPrompt(): Promise<void> {
    return Promise.resolve();
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

class FakeInput extends EventEmitter {
  isTTY = true;
  columns = 120;
  rows = 28;
  rawMode = false;
  resumed = false;

  setRawMode(mode: boolean): void {
    this.rawMode = mode;
  }

  resume(): void {
    this.resumed = true;
  }

  pause(): void {
    this.resumed = false;
  }
}

class FakeOutput {
  isTTY = true;
  columns = 110;
  rows = 26;
  chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  lastFrame(): string {
    const joined = this.chunks.join("");
    const marker = "\u001B[2J\u001B[H";
    const index = joined.lastIndexOf(marker);
    return index >= 0 ? joined.slice(index + marker.length) : joined;
  }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function emitKey(
  input: FakeInput,
  str: string,
  key: Partial<{ name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }>,
): void {
  input.emit("keypress", str, {
    ctrl: false,
    shift: false,
    meta: false,
    sequence: str,
    ...key,
  });
}

test("keyboard focus cycles across sidebar transcript activity and composer", async () => {
  const api = new FakeApiClient();
  const controller = new TuiController({ apiClient: api });
  const input = new FakeInput();
  const output = new FakeOutput();
  const app = new TerminalTuiApp(controller, input, output);
  const state = app as unknown as { focus: string; close(): Promise<void> };

  const runPromise = app.run();
  await settle();

  assert.equal(state.focus, "composer");
  emitKey(input, "\t", { name: "tab" });
  assert.equal(state.focus, "sidebar");
  emitKey(input, "\t", { name: "tab" });
  assert.equal(state.focus, "transcript");
  emitKey(input, "\t", { name: "tab" });
  assert.equal(state.focus, "activity");
  emitKey(input, "\t", { name: "tab", shift: true });
  assert.equal(state.focus, "transcript");

  await state.close();
  await runPromise;
});

test("keyboard scrolling works for transcript and activity", async () => {
  const api = new FakeApiClient();
  const controller = new TuiController({ apiClient: api });
  for (let index = 0; index < 18; index += 1) {
    controller.store.view.transcript.push({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index}`,
      timestampMs: 1000 + index,
      thinking: "",
    });
    controller.store.view.toolCalls.push({
      rowId: `tool-${index}`,
      toolUseId: `tool-${index}`,
      name: `tool ${index}`,
      input: {},
      timestampMs: 2000 + index,
      output: `output ${index}`,
      success: true,
      agentId: null,
    });
  }

  const input = new FakeInput();
  const output = new FakeOutput();
  output.rows = 18;
  const app = new TerminalTuiApp(controller, input, output);
  const state = app as unknown as {
    focus: string;
    transcriptScroll: number;
    activityScroll: number;
    close(): Promise<void>;
  };

  const runPromise = app.run();
  await settle();

  emitKey(input, "\t", { name: "tab" });
  emitKey(input, "\t", { name: "tab" });
  emitKey(input, "", { name: "pageup" });
  assert.ok(state.transcriptScroll > 0);

  emitKey(input, "\t", { name: "tab" });
  emitKey(input, "", { name: "pageup" });
  assert.ok(state.activityScroll > 0);
  emitKey(input, "", { name: "end" });
  assert.equal(state.activityScroll, 0);

  await state.close();
  await runPromise;
});

test("composer cursor movement stays separate from transcript scrolling", async () => {
  const api = new FakeApiClient();
  const controller = new TuiController({ apiClient: api });
  for (let index = 0; index < 14; index += 1) {
    controller.store.view.transcript.push({
      role: "assistant",
      content: `line ${index}`,
      timestampMs: 1000 + index,
      thinking: "",
    });
  }

  const input = new FakeInput();
  const output = new FakeOutput();
  output.rows = 16;
  const app = new TerminalTuiApp(controller, input, output);
  const state = app as unknown as {
    cursorIndex: number;
    transcriptScroll: number;
    close(): Promise<void>;
  };

  const runPromise = app.run();
  await settle();

  emitKey(input, "a", { name: "a" });
  emitKey(input, "b", { name: "b" });
  emitKey(input, "", { name: "left", sequence: "\u001B[D" });
  assert.equal(state.cursorIndex, 1);
  assert.equal(state.transcriptScroll, 0);

  emitKey(input, "\t", { name: "tab" });
  emitKey(input, "\t", { name: "tab" });
  emitKey(input, "", { name: "up", sequence: "\u001B[A" });
  assert.ok(state.transcriptScroll > 0);

  await state.close();
  await runPromise;
});

test("preserves quick actions for new retry cancel enter esc and quit", async () => {
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
    ],
    events: [],
  });

  const controller = new TuiController({ apiClient: api });
  const input = new FakeInput();
  const output = new FakeOutput();
  const app = new TerminalTuiApp(controller, input, output);
  const state = app as unknown as {
    inputBuffer: string;
    sidebarIndex: number;
  };

  const runPromise = app.run();
  await settle();

  emitKey(input, "h", { name: "h" });
  emitKey(input, "i", { name: "i" });
  assert.equal(state.inputBuffer, "hi");
  emitKey(input, "", { name: "escape", sequence: "\u001B" });
  assert.equal(state.inputBuffer, "");

  emitKey(input, "\t", { name: "tab" });
  emitKey(input, "", { name: "down", sequence: "\u001B[B" });
  assert.equal(state.sidebarIndex, 1);
  emitKey(input, "", { name: "enter", sequence: "\r" });
  await settle();
  assert.equal(controller.store.view.conversationId, "conv-1");

  controller.store.view.conversationId = "conv-1";
  emitKey(input, "", { name: "r", ctrl: true, sequence: "\u0012" });
  emitKey(input, "", { name: "k", ctrl: true, sequence: "\u000b" });
  emitKey(input, "", { name: "n", ctrl: true, sequence: "\u000e" });
  await settle();

  assert.deepEqual(api.retried, ["conv-1"]);
  assert.deepEqual(api.cancelled, ["conv-1"]);
  assert.equal(controller.store.view.conversationId, null);

  emitKey(input, "q", { name: "q", sequence: "q" });
  await runPromise;
  assert.match(output.lastFrame(), /quit|Synapse TUI|Compose/i);
});
