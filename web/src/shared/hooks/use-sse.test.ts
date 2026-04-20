import { describe, expect, it } from "@jest/globals";
import {
  BACKEND_DISCONNECT_ERROR,
  createTerminalDisconnectEvent,
  parseSSEEvent,
  shouldEmitTerminalDisconnectEvent,
  shouldFlushEventImmediately,
  shouldScheduleReconnect,
} from "./use-sse";

describe("shouldScheduleReconnect", () => {
  it("returns false when stopped", () => {
    expect(
      shouldScheduleReconnect({
        isStopped: true,
        retryCount: 0,
        maxRetries: 3,
        hasPendingTimer: false,
      }),
    ).toBe(false);
  });

  it("returns false when max retries reached", () => {
    expect(
      shouldScheduleReconnect({
        isStopped: false,
        retryCount: 3,
        maxRetries: 3,
        hasPendingTimer: false,
      }),
    ).toBe(false);
  });

  it("returns false when a timer is already pending", () => {
    expect(
      shouldScheduleReconnect({
        isStopped: false,
        retryCount: 1,
        maxRetries: 3,
        hasPendingTimer: true,
      }),
    ).toBe(false);
  });

  it("returns true when retry is allowed", () => {
    expect(
      shouldScheduleReconnect({
        isStopped: false,
        retryCount: 1,
        maxRetries: 3,
        hasPendingTimer: false,
      }),
    ).toBe(true);
  });
});

describe("shouldEmitTerminalDisconnectEvent", () => {
  it("returns false when the stream was already intentionally stopped", () => {
    expect(
      shouldEmitTerminalDisconnectEvent({
        isStopped: true,
        retryCount: 3,
        maxRetries: 3,
      }),
    ).toBe(false);
  });

  it("returns false before retry exhaustion", () => {
    expect(
      shouldEmitTerminalDisconnectEvent({
        isStopped: false,
        retryCount: 2,
        maxRetries: 3,
      }),
    ).toBe(false);
  });

  it("returns true when retry exhaustion happens on an active stream", () => {
    expect(
      shouldEmitTerminalDisconnectEvent({
        isStopped: false,
        retryCount: 3,
        maxRetries: 3,
      }),
    ).toBe(true);
  });
});

describe("createTerminalDisconnectEvent", () => {
  it("creates a synthetic terminal task_error event", () => {
    expect(createTerminalDisconnectEvent(42)).toEqual({
      type: "task_error",
      data: { error: BACKEND_DISCONNECT_ERROR },
      timestamp: 42,
      iteration: null,
    });
  });
});

describe("parseSSEEvent", () => {
  it("accepts skill_setup_failed events", () => {
    const parsed = parseSSEEvent(
      JSON.stringify({
        event_type: "skill_setup_failed",
        data: {
          name: "docx",
          phase: "dependencies",
          error: "pip install failed",
          source: "auto",
        },
        timestamp: 123,
        iteration: 1,
      }),
      "skill_setup_failed",
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("skill_setup_failed");
    expect(parsed?.data.name).toBe("docx");
       expect(parsed?.data.phase).toBe("dependencies");
  });

  it("coerces numeric tool_id on tool_call and tool_result for stable correlation", () => {
    const call = parseSSEEvent(
      JSON.stringify({
        event_type: "tool_call",
        data: {
          tool_name: "activate_skill",
          tool_input: { name: "docx" },
          tool_id: 9001,
        },
        timestamp: 1,
        iteration: 0,
      }),
      "tool_call",
    );
    expect(call?.data.tool_id).toBe("9001");

    const res = parseSSEEvent(
      JSON.stringify({
        event_type: "tool_result",
        data: { tool_id: 9001, success: true, output: "ok" },
        timestamp: 2,
        iteration: 0,
      }),
      "tool_result",
    );
    expect(res?.data.tool_id).toBe("9001");
  });

  it("preserves worker attribution on text_delta events", () => {
    const parsed = parseSSEEvent(
      JSON.stringify({
        event_type: "text_delta",
        data: { delta: "draft", agent_id: "agent-7" },
        timestamp: 3,
        iteration: 2,
      }),
      "text_delta",
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("text_delta");
    expect(parsed?.data.delta).toBe("draft");
    expect(parsed?.data.agent_id).toBe("agent-7");
  });

  it("accepts preview and context compaction events from the backend stream", () => {
    const preview = parseSSEEvent(
      JSON.stringify({
        event_type: "preview_available",
        data: { port: 3001, url: "/api/conversations/c1/preview/" },
        timestamp: 4,
        iteration: 2,
      }),
      "preview_available",
    );
    expect(preview?.type).toBe("preview_available");
    expect(preview?.data.url).toBe("/api/conversations/c1/preview/");

    const compacted = parseSSEEvent(
      JSON.stringify({
        event_type: "context_compacted",
        data: { original_messages: 12, compacted_messages: 4, summary_scope: "conversation" },
        timestamp: 5,
        iteration: 2,
      }),
      "context_compacted",
    );
    expect(compacted?.type).toBe("context_compacted");
    expect(compacted?.data.original_messages).toBe(12);
    expect(compacted?.data.compacted_messages).toBe(4);
  });

  it("accepts skill_dependency_failed events", () => {
    const parsed = parseSSEEvent(
      JSON.stringify({
        event_type: "skill_dependency_failed",
        data: {
          name: "frontend-design",
          manager: "npm",
          packages: "framer-motion",
          error: "install failed",
        },
        timestamp: 6,
        iteration: 2,
      }),
      "skill_dependency_failed",
    );

    expect(parsed?.type).toBe("skill_dependency_failed");
    expect(parsed?.data.manager).toBe("npm");
    expect(parsed?.data.packages).toBe("framer-motion");
  });
});

describe("shouldFlushEventImmediately", () => {
  it("flushes terminal and interaction-critical events immediately", () => {
    expect(shouldFlushEventImmediately("turn_complete")).toBe(true);
    expect(shouldFlushEventImmediately("ask_user")).toBe(true);
    expect(shouldFlushEventImmediately("skill_activated")).toBe(true);
    expect(shouldFlushEventImmediately("skill_dependency_failed")).toBe(true);
    expect(shouldFlushEventImmediately("skill_setup_failed")).toBe(true);
  });

  it("does not flush token-level model updates immediately", () => {
    expect(shouldFlushEventImmediately("text_delta")).toBe(false);
    expect(shouldFlushEventImmediately("llm_response")).toBe(false);
  });
});
