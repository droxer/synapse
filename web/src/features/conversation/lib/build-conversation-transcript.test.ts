import { describe, expect, it } from "@jest/globals";
import { buildConversationTranscriptState } from "./build-conversation-transcript";
import { resolveConversationHistoryResults } from "../hooks/use-conversation-history";
import type { AgentEvent, ChatMessage } from "@/shared/types";

describe("buildConversationTranscriptState", () => {
  it("produces one shared merged transcript for history and live events", () => {
    const historyMessages: ChatMessage[] = [
      { role: "user", content: "Question", timestamp: 1000 },
      { role: "assistant", content: "Final answer", timestamp: 4000 },
    ];
    const historyEvents: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "Question" },
        timestamp: 1000,
        iteration: null,
      },
      {
        type: "llm_response",
        data: { text: "Final answer", stop_reason: "end_turn" },
        timestamp: 4000,
        iteration: null,
      },
    ];
    const liveEvents: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "Question" },
        timestamp: 1000,
        iteration: null,
      },
      {
        type: "llm_response",
        data: { text: "Partial answer", stop_reason: "max_tokens" },
        timestamp: 2500,
        iteration: null,
      },
      {
        type: "llm_response",
        data: { text: "Final answer", stop_reason: "end_turn" },
        timestamp: 4000,
        iteration: null,
      },
    ];

    const transcript = buildConversationTranscriptState(
      historyMessages,
      historyEvents,
      liveEvents,
    );

    expect(transcript.effectiveEvents).toHaveLength(3);
    expect(transcript.messages.map((message) => message.content)).toEqual([
      "Question",
      "Partial answer",
      "Final answer",
    ]);
  });

  it("keeps replayed assistant replies scoped to synthesized turn boundaries for older histories", () => {
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
              content: { text: "Summarize report" },
              iteration: null,
              created_at: "2026-04-18T07:14:52.297999Z",
            },
            {
              id: "message-2",
              role: "assistant",
              content: { text: "Here is the summary for report A." },
              iteration: 1,
              created_at: "2026-04-18T07:14:55.297999Z",
            },
            {
              id: "message-3",
              role: "user",
              content: { text: "Summarize report" },
              iteration: null,
              created_at: "2026-04-18T07:15:02.297999Z",
            },
            {
              id: "message-4",
              role: "assistant",
              content: { text: "Here is the summary for report B." },
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
              type: "turn_complete",
              data: { result: "Here is the summary for report A." },
              timestamp: "2026-04-18T07:14:55.297999Z",
              iteration: 1,
            },
            {
              type: "turn_complete",
              data: { result: "Here is the summary for report B." },
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

    const transcript = buildConversationTranscriptState(
      resolved.messages,
      resolved.events,
      [],
    );

    expect(transcript.effectiveEvents.map((event) => event.type)).toEqual([
      "turn_start",
      "turn_complete",
      "turn_start",
      "turn_complete",
    ]);
    expect(transcript.messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      "user:Summarize report",
      "assistant:Here is the summary for report A.",
      "user:Summarize report",
      "assistant:Here is the summary for report B.",
    ]);
  });

  it("renders one canonical assistant reply when live events include both task_complete and turn_complete", () => {
    const transcript = buildConversationTranscriptState(
      [],
      [],
      [
        {
          type: "turn_start",
          data: { message: "Question" },
          timestamp: 1000,
          iteration: null,
        },
        {
          type: "task_complete",
          data: { summary: "Task-layer answer" },
          timestamp: 2000,
          iteration: 1,
        },
        {
          type: "turn_complete",
          data: { result: "Final answer" },
          timestamp: 3000,
          iteration: 1,
        },
      ],
    );

    const assistantMessages = transcript.messages.filter((message) => message.role === "assistant");

    expect(transcript.effectiveEvents.map((event) => event.type)).toEqual([
      "turn_start",
      "task_complete",
      "turn_complete",
    ]);
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("Final answer");
  });

  it("keeps task_complete assistant reply when turn_complete has no result", () => {
    const transcript = buildConversationTranscriptState(
      [],
      [],
      [
        {
          type: "turn_start",
          data: { message: "Question" },
          timestamp: 1000,
          iteration: null,
        },
        {
          type: "task_complete",
          data: { summary: "Task-layer answer" },
          timestamp: 2000,
          iteration: 1,
        },
        {
          type: "turn_complete",
          data: { result: "" },
          timestamp: 3000,
          iteration: 1,
        },
      ],
    );

    const assistantMessages = transcript.messages.filter((message) => message.role === "assistant");

    expect(transcript.agentState.taskState).toBe("complete");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("Task-layer answer");
  });

  it("keeps one assistant bubble when persisted history arrives with think tags around the final answer", () => {
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
            {
              id: "message-2",
              role: "assistant",
              content: { text: "<think>internal notes</think>\n\nVisible answer" },
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
              type: "turn_start",
              data: { message: "hello" },
              timestamp: "2026-04-18T07:14:52.297999Z",
              iteration: null,
            },
            {
              type: "turn_complete",
              data: { result: "Visible answer" },
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

    const transcript = buildConversationTranscriptState(
      resolved.messages,
      resolved.events,
      [],
    );

    const assistantMessages = transcript.messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("Visible answer");
    expect(assistantMessages[0]?.thinkingContent).toBe("internal notes");
  });

  it("keeps one user and one assistant message when terminal refetch overlaps live turn events", () => {
    const historyMessages: ChatMessage[] = [
      {
        messageId: "history:user-1",
        role: "user",
        content: "hello",
        timestamp: 1_000,
        source: "history",
      },
      {
        messageId: "history:assistant-1",
        role: "assistant",
        content: "done",
        timestamp: 3_000,
        source: "history",
      },
    ];
    const historyEvents: AgentEvent[] = [
      {
        type: "turn_start",
        data: { message: "hello" },
        timestamp: 1_000,
        iteration: null,
      },
      {
        type: "turn_complete",
        data: { result: "done", artifact_ids: ["artifact-1"] },
        timestamp: 3_000,
        iteration: 1,
      },
    ];
    const liveEvents: AgentEvent[] = [
      {
        type: "turn_start",
        data: {
          message: "hello",
          orchestrator_mode: "agent",
          execution_shape: "single_agent",
          execution_rationale: "simple turn",
        },
        timestamp: 1_000,
        iteration: null,
      },
      {
        type: "turn_complete",
        data: { result: "done" },
        timestamp: 3_000,
        iteration: 1,
      },
    ];

    const transcript = buildConversationTranscriptState(
      historyMessages,
      historyEvents,
      liveEvents,
    );

    expect(transcript.effectiveEvents).toHaveLength(2);
    expect(transcript.messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      "user:hello",
      "assistant:done",
    ]);
  });

  it("replays persisted planner user_message as the final visible answer after refresh", () => {
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
              content: { text: "Use planner mode" },
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
              data: { message: "Use planner mode", orchestrator_mode: "planner" },
              timestamp: "2026-04-18T07:14:52.297999Z",
              iteration: null,
            },
            {
              type: "message_user",
              data: { message: "Planner final answer" },
              timestamp: "2026-04-18T07:14:55.297999Z",
              iteration: 1,
            },
            {
              type: "turn_complete",
              data: { result: "" },
              timestamp: "2026-04-18T07:14:56.297999Z",
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

    const transcript = buildConversationTranscriptState(
      resolved.messages,
      resolved.events,
      [],
    );

    expect(transcript.effectiveEvents.map((event) => event.type)).toEqual([
      "turn_start",
      "message_user",
      "turn_complete",
    ]);
    expect(transcript.messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      "user:Use planner mode",
      "assistant:Planner final answer",
    ]);
  });

  it("keeps the fuller planner llm_response instead of the persisted terminal summary after refresh", () => {
    const fullReport = [
      "数据已补齐，现在进入最后的综合分析阶段，输出完整的旗舰手机横评报告。",
      "",
      "# 2025 年主流旗舰手机综合对比评测",
      "",
      "## 一、参评机型速览",
      "",
      "| 机型 | 处理器 | 推荐场景 |",
      "| --- | --- | --- |",
      "| vivo X200 Pro | 天玑 9400 | 影像与续航均衡 |",
      "| iPhone 16 Pro Max | A18 Pro | 视频与生态 |",
    ].join("\n");
    const summary = "完成了 2025 年主流旗舰手机综合对比评测，并给出分场景选购推荐和最终榜单排名。";
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
              content: { text: "比较评测各大手机厂商的旗舰手机" },
              iteration: null,
              created_at: "2026-04-26T00:02:17.976975Z",
            },
            {
              id: "message-2",
              role: "assistant",
              content: { text: summary },
              iteration: null,
              created_at: "2026-04-26T00:06:52.065328Z",
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
              data: {
                message: "比较评测各大手机厂商的旗舰手机",
                orchestrator_mode: "planner",
              },
              timestamp: "2026-04-26T00:02:17.965972Z",
              iteration: null,
            },
            {
              type: "llm_response",
              data: { text: fullReport, stop_reason: "tool_use", tool_call_count: 1 },
              timestamp: "2026-04-26T00:06:52.032582Z",
              iteration: 7,
            },
            {
              type: "turn_complete",
              data: { result: summary, artifact_ids: [] },
              timestamp: "2026-04-26T00:06:52.036368Z",
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

    const transcript = buildConversationTranscriptState(
      resolved.messages,
      resolved.events,
      [],
    );

    const assistantMessages = transcript.messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe(fullReport);
  });
});
