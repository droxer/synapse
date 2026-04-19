import assert from "node:assert/strict";
import test from "node:test";

import { SynapseApiClient } from "../src/api-client.ts";

test("client creates, sends, and lists conversations", async () => {
  const requests: Array<{ method: string; path: string; body: string }> = [];

  const client = new SynapseApiClient({
    baseUrl: "http://example.test",
    fetchImpl: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const body = init?.body ? String(init.body) : "";
      requests.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        body,
      });

      if ((init?.method ?? "GET") === "GET" && url.pathname === "/conversations") {
        return Response.json({
          items: [
            {
              id: "conv-1",
              title: "Hello",
              created_at: "2026-04-19T10:00:00+00:00",
              updated_at: "2026-04-19T11:00:00+00:00",
            },
          ],
          total: 1,
        });
      }

      if ((init?.method ?? "GET") === "POST" && url.pathname === "/conversations") {
        assert.deepEqual(JSON.parse(body), {
          message: "hello",
          skills: [],
          use_planner: true,
        });
        return Response.json({ conversation_id: "conv-1" });
      }

      if (
        (init?.method ?? "GET") === "POST"
        && url.pathname === "/conversations/conv-1/messages"
      ) {
        assert.deepEqual(JSON.parse(body), {
          message: "follow up",
          skills: [],
        });
        return Response.json({ conversation_id: "conv-1" });
      }

      throw new Error(`Unexpected request: ${(init?.method ?? "GET")} ${url}`);
    },
  });

  const conversations = await client.listConversations();
  const conversationId = await client.createConversation("hello", {
    usePlanner: true,
  });
  await client.sendMessage("conv-1", "follow up");

  assert.deepEqual(
    conversations.map((conversation) => conversation.id),
    ["conv-1"],
  );
  assert.equal(conversationId, "conv-1");
  assert.deepEqual(
    requests.map((request) => [request.method, request.path]),
    [
      ["GET", "/conversations"],
      ["POST", "/conversations"],
      ["POST", "/conversations/conv-1/messages"],
    ],
  );
});

test("client preserves base path and auth headers", async () => {
  const seen = {
    path: "",
    authorization: "",
    proxySecret: "",
    userEmail: "",
    userGoogleId: "",
    cookie: "",
  };

  const client = new SynapseApiClient({
    baseUrl: "http://example.test/api",
    apiKey: "api-key",
    proxySecret: "proxy-secret",
    userEmail: "user@example.com",
    userGoogleId: "google-123",
    cookie: "session=abc",
    fetchImpl: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const headers = new Headers(init?.headers);
      seen.path = url.pathname;
      seen.authorization = headers.get("authorization") ?? "";
      seen.proxySecret = headers.get("x-proxy-secret") ?? "";
      seen.userEmail = headers.get("x-user-email") ?? "";
      seen.userGoogleId = headers.get("x-user-google-id") ?? "";
      seen.cookie = headers.get("cookie") ?? "";
      return Response.json({ items: [], total: 0 });
    },
  });

  await client.listConversations();

  assert.equal(seen.path, "/api/conversations");
  assert.equal(seen.authorization, "Bearer api-key");
  assert.equal(seen.proxySecret, "proxy-secret");
  assert.equal(seen.userEmail, "user@example.com");
  assert.equal(seen.userGoogleId, "google-123");
  assert.equal(seen.cookie, "session=abc");
});

test("client injects local dev identity for direct localhost backend", async () => {
  const seen = {
    path: "",
    userEmail: "",
    userGoogleId: "",
    userName: "",
  };

  const client = new SynapseApiClient({
    baseUrl: "http://localhost:8000",
    fetchImpl: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const headers = new Headers(init?.headers);
      seen.path = url.pathname;
      seen.userEmail = headers.get("x-user-email") ?? "";
      seen.userGoogleId = headers.get("x-user-google-id") ?? "";
      seen.userName = headers.get("x-user-name") ?? "";
      return Response.json({ items: [], total: 0 });
    },
  });

  await client.listConversations();

  assert.equal(seen.path, "/conversations");
  assert.equal(seen.userEmail, "synapse-tui-local@localhost");
  assert.equal(seen.userGoogleId, "synapse-tui-local");
  assert.equal(seen.userName, "Synapse TUI Local");
});

test("client does not inject local dev identity for proxied api urls", async () => {
  const seen = {
    path: "",
    userEmail: "",
    userGoogleId: "",
  };

  const client = new SynapseApiClient({
    baseUrl: "http://localhost:3000/api",
    fetchImpl: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const headers = new Headers(init?.headers);
      seen.path = url.pathname;
      seen.userEmail = headers.get("x-user-email") ?? "";
      seen.userGoogleId = headers.get("x-user-google-id") ?? "";
      return Response.json({ items: [], total: 0 });
    },
  });

  await client.listConversations();

  assert.equal(seen.path, "/api/conversations");
  assert.equal(seen.userEmail, "");
  assert.equal(seen.userGoogleId, "");
});

test("client fetches history, control actions, and SSE events", async () => {
  const eventsStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'event: turn_start\ndata: {"event_type":"turn_start","data":{"message":"hello"},"timestamp":"2026-04-19T10:00:00+00:00"}\n\n'
          + "event: done\ndata: {}\n\n",
        ),
      );
      controller.close();
    },
  });

  const client = new SynapseApiClient({
    baseUrl: "http://example.test",
    fetchImpl: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (method === "GET" && url.pathname === "/conversations/conv-1/messages") {
        return Response.json({
          conversation_id: "conv-1",
          title: "History",
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: { text: "hello" },
              iteration: null,
              created_at: "2026-04-19T10:00:00+00:00",
            },
          ],
        });
      }

      if (method === "GET" && url.pathname === "/conversations/conv-1/events/history") {
        return Response.json({
          events: [
            {
              type: "turn_start",
              data: { message: "hello" },
              timestamp: "2026-04-19T10:00:00+00:00",
              iteration: null,
            },
          ],
        });
      }

      if (method === "GET" && url.pathname === "/conversations/conv-1/events") {
        return new Response(eventsStream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      if (method === "POST" && url.pathname === "/conversations/conv-1/respond") {
        assert.deepEqual(JSON.parse(String(init?.body ?? "")), {
          request_id: "req-1",
          response: "answer",
        });
        return Response.json({ status: "ok" });
      }

      if (method === "POST" && url.pathname === "/conversations/conv-1/cancel") {
        return Response.json({ status: "ok" });
      }

      if (method === "POST" && url.pathname === "/conversations/conv-1/retry") {
        return Response.json({ status: "ok" });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  });

  const { title, messages } = await client.fetchMessages("conv-1");
  const events = await client.fetchEvents("conv-1");
  const streamed = [];
  for await (const event of client.streamEventsOnce("conv-1")) {
    streamed.push(event);
  }
  await client.respondToPrompt("conv-1", "req-1", "answer");
  await client.cancelTurn("conv-1");
  await client.retryTurn("conv-1");

  assert.equal(title, "History");
  assert.deepEqual(messages.map((message) => message.content), ["hello"]);
  assert.deepEqual(events.map((event) => event.type), ["turn_start"]);
  assert.deepEqual(streamed.map((event) => event.type), ["turn_start"]);
});
