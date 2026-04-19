import assert from "node:assert/strict";
import test from "node:test";

import { iterSseMessages, parseAgentEvent } from "../src/sse.ts";

async function* iterateLines(lines: string[]): AsyncIterable<string> {
  for (const line of lines) {
    yield line;
  }
}

test("iterSseMessages parses basic frames", async () => {
  const frames = [];
  for await (const frame of iterSseMessages(
    iterateLines([
      ": keepalive",
      "event: text_delta",
      'data: {"event_type":"text_delta","data":{"delta":"Hi"},"timestamp":1}',
      "",
    ]),
  )) {
    frames.push(frame);
  }

  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.event, "text_delta");
  assert.match(frames[0]?.data ?? "", /"delta":"Hi"/);
});

test("iterSseMessages joins multiline data", async () => {
  const frames = [];
  for await (const frame of iterSseMessages(
    iterateLines([
      "event: message_user",
      "data: line-one",
      "data: line-two",
      "",
    ]),
  )) {
    frames.push(frame);
  }

  assert.deepEqual(frames, [
    {
      event: "message_user",
      data: "line-one\nline-two",
    },
  ]);
});

test("parseAgentEvent normalizes payload", () => {
  const event = parseAgentEvent(
    '{"event_type":"turn_complete","data":{"result":"done"},"timestamp":1712345678.5,"iteration":2}',
    "turn_complete",
  );

  assert.ok(event);
  assert.equal(event?.type, "turn_complete");
  assert.deepEqual(event?.data, { result: "done" });
  assert.equal(event?.timestampMs, 1712345678500);
  assert.equal(event?.iteration, 2);
});
