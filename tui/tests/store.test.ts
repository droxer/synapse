import assert from "node:assert/strict";
import test from "node:test";

import { ConversationStore } from "../src/store.ts";
import type { ConversationEvent, HistoryMessage } from "../src/types.ts";

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

test("store accumulates text deltas into one assistant message", () => {
  const store = new ConversationStore();

  store.applyEvent(createEvent("turn_start", { message: "hello" }, 1000));
  store.applyEvent(createEvent("thinking", { thinking: "plan" }, 1100));
  store.applyEvent(createEvent("text_delta", { delta: "Hel" }, 1200));
  store.applyEvent(createEvent("text_delta", { delta: "lo" }, 1250));
  store.applyEvent(createEvent("turn_complete", { result: "" }, 1300));

  assert.deepEqual(
    store.view.transcript.map((entry) => entry.role),
    ["user", "assistant"],
  );
  assert.equal(store.view.transcript.at(-1)?.content, "Hello");
  assert.equal(store.view.transcript.at(-1)?.thinking, "plan");
});

test("store pairs tool calls with results", () => {
  const store = new ConversationStore();

  store.applyEvent(
    createEvent(
      "tool_call",
      {
        tool_id: "tool-1",
        tool_name: "shell_exec",
        tool_input: { command: "ls" },
      },
      1000,
    ),
  );
  store.applyEvent(createEvent("sandbox_stdout", { text: "file.txt\n" }, 1100));
  store.applyEvent(
    createEvent(
      "tool_result",
      { tool_id: "tool-1", result: "done", success: true },
      1200,
    ),
  );

  assert.equal(store.view.toolCalls.length, 1);
  assert.equal(store.view.toolCalls[0]?.name, "shell_exec");
  assert.match(store.view.toolCalls[0]?.output ?? "", /done$/);
  assert.equal(store.view.toolCalls[0]?.success, true);
});

test("store parses plan steps and updates agent status", () => {
  const store = new ConversationStore();

  store.applyEvent(
    createEvent(
      "plan_created",
      {
        steps: [
          {
            name: "Inspect codebase",
            description: "Understand the task",
            execution_type: "parallel_worker",
          },
        ],
      },
      1000,
    ),
  );
  store.applyEvent(
    createEvent(
      "agent_spawn",
      {
        agent_id: "agent-1",
        name: "Inspector",
        task: "Inspect codebase",
      },
      1100,
    ),
  );
  store.applyEvent(
    createEvent(
      "agent_complete",
      { agent_id: "agent-1", terminal_state: "complete" },
      1200,
    ),
  );

  assert.equal(store.view.planSteps[0]?.status, "complete");
  assert.equal(store.view.agentStatuses[0]?.status, "complete");
});

test("store clears pending prompt after user response", () => {
  const store = new ConversationStore();

  store.applyEvent(
    createEvent(
      "ask_user",
      {
        request_id: "req-1",
        question: "Pick one",
        options: [{ label: "A", value: "a" }],
        prompt_metadata: { allow_freeform: false },
      },
      1000,
    ),
  );

  assert.equal(store.view.pendingAsk?.requestId, "req-1");
  assert.equal(store.view.pendingAsk?.options[0]?.value, "a");

  store.applyEvent(createEvent("user_response", { request_id: "req-1" }, 1100));
  assert.equal(store.view.pendingAsk, null);
});

test("store hydrate replays tail events after persisted messages", () => {
  const store = new ConversationStore();
  const historyMessages: HistoryMessage[] = [
    {
      id: "msg-1",
      role: "user",
      content: "hello",
      iteration: null,
      timestampMs: 1000,
    },
  ];
  const historyEvents = [
    createEvent("turn_start", { message: "hello" }, 1000),
    createEvent("text_delta", { delta: "Hi" }, 1500),
    createEvent("turn_complete", { result: "" }, 1600),
  ];

  store.hydrate("conv-1", "History", historyMessages, historyEvents);

  assert.deepEqual(
    store.view.transcript.map((entry) => entry.role),
    ["user", "assistant"],
  );
  assert.equal(store.view.transcript.at(-1)?.content, "Hi");
  assert.equal(store.view.conversationId, "conv-1");
});
