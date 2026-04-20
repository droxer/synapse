import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { shouldAutoScrollToBottom } from "./conversation-scroll";
import { getLatestTurnMode } from "./conversation-mode";
import { areMessageRowsEqual } from "./message-row-memo";
import { ConversationWorkspace, MessageRow } from "./ConversationWorkspace";
import type { AgentEvent, ChatMessage, PlanStep } from "@/shared/types";

let lastAgentProgressCardProps: Record<string, unknown> | null = null;
let lastThreadTasksPanelProps: Record<string, unknown> | null = null;
let lastTopBarProps: Record<string, unknown> | null = null;

jest.mock("@/i18n", () => ({
  __esModule: true,
  useTranslation: () => ({
    locale: "en",
    setLocale: () => undefined,
    t: (key: string) => {
      const map: Record<string, string> = {
        "chat.plannerModeActive": "Planner mode active",
        "plan.placeholderDescription": "Preparing a visible plan for this turn.",
        "conversation.emptyAssistantBody": "No text in this reply.",
        "conversation.imageAlt": "AI-generated image artifact",
        "conversation.imageUnavailable": "Image unavailable",
        "thinking.reasoning": "Reasoning",
      };
      return map[key] ?? key;
    },
    tArray: (key: string) => [key],
  }),
}));

jest.mock("framer-motion", () => ({
  __esModule: true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => createElement(React.Fragment, null, children),
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => createElement("div", props, children),
    span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => createElement("span", props, children),
  },
  useReducedMotion: () => true,
}));

jest.mock("@/shared/components", () => ({
  __esModule: true,
  TopBar: (props: Record<string, unknown>) => {
    lastTopBarProps = props;
    return null;
  },
  MarkdownRenderer: ({
    content,
  }: {
    content: string;
  }) => createElement("div", { "data-testid": "markdown" }, content),
}));

jest.mock("@/features/agent-computer", () => ({
  __esModule: true,
  AgentProgressCard: (props: Record<string, unknown>) => {
    lastAgentProgressCardProps = props;
    return null;
  },
  AgentComputerPanel: () => null,
}));

jest.mock("./ThreadTasksPanel", () => ({
  __esModule: true,
  ThreadTasksPanel: (props: Record<string, unknown>) => {
    lastThreadTasksPanelProps = props;
    return createElement("div", { "data-testid": "thread-tasks-panel" });
  },
}));

jest.mock("@/features/conversation", () => ({
  __esModule: true,
  ChatInput: () => null,
}));

describe("shouldAutoScrollToBottom", () => {
  it("scrolls on first populate", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 0,
        nextActivityCount: 1,
        distanceFromBottom: 999,
      }),
    ).toBe(true);
  });

  it("does not scroll when there is no new activity", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 5,
        nextActivityCount: 5,
        distanceFromBottom: 10,
      }),
    ).toBe(false);
  });

  it("scrolls when new activity arrives near bottom", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 5,
        nextActivityCount: 6,
        distanceFromBottom: 60,
      }),
    ).toBe(true);
  });

  it("does not scroll when user is far from bottom", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 5,
        nextActivityCount: 6,
        distanceFromBottom: 300,
      }),
    ).toBe(false);
  });
});

describe("getLatestTurnMode", () => {
  it("returns planner when latest turn_start is planner", () => {
    const events: AgentEvent[] = [
      { type: "turn_start", data: { message: "one", orchestrator_mode: "agent" }, timestamp: 1, iteration: null },
      { type: "turn_start", data: { message: "two", orchestrator_mode: "planner" }, timestamp: 2, iteration: null },
    ];
    expect(getLatestTurnMode(events)).toBe("planner");
  });

  it("returns null when latest turn_start has no mode", () => {
    const events: AgentEvent[] = [
      { type: "turn_start", data: { message: "one", orchestrator_mode: "planner" }, timestamp: 1, iteration: null },
      { type: "turn_start", data: { message: "two" }, timestamp: 2, iteration: null },
    ];
    expect(getLatestTurnMode(events)).toBeNull();
  });
});

describe("areMessageRowsEqual", () => {
  const baseMessage: ChatMessage = {
    messageId: "event-turn:1:assistant:0",
    role: "assistant",
    content: "stable",
    timestamp: 1,
    source: "event",
    turnId: "event-turn:1",
  };

  const planSteps: readonly PlanStep[] = [];

  it("keeps older rows memoized when only the latest row is streaming", () => {
    expect(
      areMessageRowsEqual(
        {
          msg: baseMessage,
          isLastAssistant: false,
          isStreamingThis: false,
          isThinkingThis: false,
          messageWidthClass: "sm:max-w-[82%]",
          embeddedPlanSteps: planSteps,
          index: 0,
          conversationId: "c1",
          taskState: "executing",
          locale: "en",
        },
        {
          msg: { ...baseMessage },
          isLastAssistant: false,
          isStreamingThis: false,
          isThinkingThis: false,
          messageWidthClass: "sm:max-w-[82%]",
          embeddedPlanSteps: planSteps,
          index: 0,
          conversationId: "c1",
          taskState: "executing",
          locale: "en",
        },
      ),
    ).toBe(true);
  });

  it("invalidates the active assistant row when streamed content changes", () => {
    expect(
      areMessageRowsEqual(
        {
          msg: {
            ...baseMessage,
            content: "Part 1",
          },
          isLastAssistant: true,
          isStreamingThis: true,
          isThinkingThis: false,
          messageWidthClass: "sm:max-w-[82%]",
          embeddedPlanSteps: planSteps,
          index: 1,
          conversationId: "c1",
          taskState: "executing",
          locale: "en",
        },
        {
          msg: {
            ...baseMessage,
            content: "Part 1 and Part 2",
          },
          isLastAssistant: true,
          isStreamingThis: true,
          isThinkingThis: false,
          messageWidthClass: "sm:max-w-[82%]",
          embeddedPlanSteps: planSteps,
          index: 1,
          conversationId: "c1",
          taskState: "executing",
          locale: "en",
        },
      ),
    ).toBe(false);
  });

  it("renders reasoning separately before the assistant response body", () => {
    const assistantMessage: ChatMessage = {
      ...baseMessage,
      thinkingEntries: [{ content: "## Inspect\n\nCheck constraints.", durationMs: 2000, timestamp: 1 }],
      content: "Final answer body.",
    };

    const html = renderToStaticMarkup(createElement(MessageRow, {
      msg: assistantMessage,
      isLastAssistant: false,
      isStreamingThis: false,
      isThinkingThis: false,
      messageWidthClass: "sm:max-w-[82%]",
      embeddedPlanSteps: planSteps,
      index: 0,
      conversationId: "c1",
      taskState: "idle",
      locale: "en",
      t: (key: string) => key,
    }));

    const thinkingIndex = html.indexOf("data-thinking-block");
    const responseIndex = html.indexOf("conversation-response-body");

    expect(thinkingIndex).toBeGreaterThanOrEqual(0);
    expect(responseIndex).toBeGreaterThan(thinkingIndex);
  });

  it("renders the full accumulated streaming content without frontend pacing", () => {
    const streamingMessage: ChatMessage = {
      ...baseMessage,
      content: "Part 1 and Part 2",
    };

    const html = renderToStaticMarkup(createElement(MessageRow, {
      msg: streamingMessage,
      isLastAssistant: true,
      isStreamingThis: true,
      isThinkingThis: false,
      messageWidthClass: "sm:max-w-[82%]",
      embeddedPlanSteps: planSteps,
      index: 1,
      conversationId: "c1",
      taskState: "executing",
      locale: "en",
      t: (key: string) => key,
    }));

    expect(html).toContain('data-testid="markdown"');
    expect(html).toContain("Part 1 and Part 2");
  });

  it("renders attachment chips for replayed user messages", () => {
    const userMessage: ChatMessage = {
      role: "user",
      content: "inspect this",
      timestamp: 100,
      attachments: [{ name: "report.csv", size: 42, type: "text/csv" }],
    };

    const html = renderToStaticMarkup(createElement(MessageRow, {
      msg: userMessage,
      isLastAssistant: false,
      isStreamingThis: false,
      isThinkingThis: false,
      messageWidthClass: "sm:max-w-[82%]",
      embeddedPlanSteps: planSteps,
      index: 0,
      conversationId: "c1",
      taskState: "idle",
      locale: "en",
      t: (key: string) => key,
    }));

    expect(html).toContain("inspect this");
    expect(html).toContain("report.csv");
  });
});

describe("ConversationWorkspace activity wiring", () => {
  it("renders event reasoning and inline fallback exactly once without standalone live replay", () => {
    const html = renderToStaticMarkup(createElement(ConversationWorkspace, {
      conversationId: "c1",
      conversationTitle: "Test",
      events: [],
      messages: [
        { role: "user", content: "Explain it", timestamp: 100 },
        {
          messageId: "event-turn:1:assistant:0",
          role: "assistant",
          content: "Final answer body.",
          timestamp: 101,
          source: "event",
          turnId: "event-turn:1",
          thinkingEntries: [{ content: "## Inspect\n\nCheck constraints.", durationMs: 0, timestamp: 100 }],
          thinkingContent: "Extra inline rationale.",
        },
      ],
      toolCalls: [],
      agentStatuses: [],
      planSteps: [],
      artifacts: [],
      taskState: "idle",
      currentThinkingEntries: [],
      isStreaming: false,
      assistantPhase: { phase: "idle" },
      isConnected: true,
      onSendMessage: () => undefined,
      isWaitingForAgent: false,
      userCancelled: false,
      isLoadingHistory: false,
    }));

    expect((html.match(/data-thinking-block=/g) ?? [])).toHaveLength(2);
    expect(html).toContain("Check constraints.");
    expect(html).toContain("Extra inline rationale.");
    expect(html).toContain("Final answer body.");
  });

  it("shows planner badge and checklist while explicit planner is pending before events arrive", () => {
    lastTopBarProps = null;
    lastAgentProgressCardProps = null;

    const html = renderToStaticMarkup(createElement(ConversationWorkspace, {
      conversationId: "c1",
      conversationTitle: "Test",
      events: [],
      messages: [{ role: "user", content: "Plan this task", timestamp: 100 }],
      toolCalls: [],
      agentStatuses: [],
      planSteps: [],
      artifacts: [],
      taskState: "idle",
      currentThinkingEntries: [],
      isStreaming: false,
      assistantPhase: { phase: "idle" },
      isConnected: true,
      explicitPlannerPending: true,
      onSendMessage: () => undefined,
      isWaitingForAgent: true,
      userCancelled: false,
      isLoadingHistory: false,
    }));

    expect((lastTopBarProps as { orchestratorMode?: unknown } | null)?.orchestratorMode).toBe("planner");
    expect((lastAgentProgressCardProps as { taskState?: unknown } | null)?.taskState).toBe("planning");
    expect(html).toContain("Planner mode active");
  });

  it("shows the planner checklist immediately even before any message rows exist", () => {
    lastTopBarProps = null;

    const html = renderToStaticMarkup(createElement(ConversationWorkspace, {
      conversationId: "c1",
      conversationTitle: "Test",
      events: [],
      messages: [],
      toolCalls: [],
      agentStatuses: [],
      planSteps: [],
      artifacts: [],
      taskState: "idle",
      currentThinkingEntries: [],
      isStreaming: false,
      assistantPhase: { phase: "idle" },
      isConnected: true,
      explicitPlannerPending: true,
      onSendMessage: () => undefined,
      isWaitingForAgent: true,
      userCancelled: false,
      isLoadingHistory: false,
    }));

    expect((lastTopBarProps as { orchestratorMode?: unknown } | null)?.orchestratorMode).toBe("planner");
    expect(html).toContain("Planner mode active");
    expect(html).not.toContain("conversation.waiting");
  });

  it("passes optimistic selected skills through to both activity surfaces during a live turn", () => {
    lastAgentProgressCardProps = null;
    lastThreadTasksPanelProps = null;

    renderToStaticMarkup(createElement(ConversationWorkspace, {
      conversationId: "c1",
      conversationTitle: "Test",
      events: [{ type: "turn_start", data: { message: "Build UI" }, timestamp: 100, iteration: null }],
      messages: [{ role: "user", content: "Build UI", timestamp: 100 }],
      toolCalls: [{
        id: "optimistic-skill:frontend-design:0",
        toolUseId: "optimistic-skill:frontend-design",
        name: "activate_skill",
        input: { name: "frontend-design" },
        timestamp: 100,
      }],
      agentStatuses: [],
      planSteps: [],
      artifacts: [],
      taskState: "executing",
      currentThinkingEntries: [],
      isStreaming: true,
      assistantPhase: { phase: "thinking" },
      isConnected: true,
      onSendMessage: () => undefined,
      isWaitingForAgent: true,
      userCancelled: false,
      isLoadingHistory: false,
    }));

    expect(lastAgentProgressCardProps).not.toBeNull();
    const progressToolCalls = ((lastAgentProgressCardProps as { toolCalls?: unknown } | null)?.toolCalls ?? []) as Array<{ input: { name?: string } }>;
    expect(progressToolCalls[0]?.input.name).toBe("frontend-design");
  });

  it("passes active thread tasks into the right-rail panel only when the panel is open", () => {
    lastThreadTasksPanelProps = null;

    renderToStaticMarkup(createElement(ConversationWorkspace, {
      conversationId: "c1",
      conversationTitle: "Test",
      events: [{ type: "turn_start", data: { message: "Later" }, timestamp: 100, iteration: null }],
      messages: [{ role: "user", content: "Later", timestamp: 100 }],
      toolCalls: [
        {
          id: "artifact-1",
          toolUseId: "artifact-1",
          name: "file_write",
          input: { path: "/workspace/report.md" },
          output: "Wrote report",
          timestamp: 99,
        },
        {
          id: "tool-1",
          toolUseId: "tool-1",
          name: "task_watch",
          input: { task_id: "bg_1" },
          output: JSON.stringify({
            task_id: "bg_1",
            title: "Follow up",
            message: "Check the report",
            status: "scheduled",
            scheduled_for: 1735718400,
          }),
          timestamp: 100,
        },
      ],
      agentStatuses: [],
      planSteps: [],
      artifacts: [],
      taskState: "executing",
      currentThinkingEntries: [],
      isStreaming: false,
      assistantPhase: { phase: "idle" },
      isConnected: true,
      onSendMessage: () => undefined,
      isWaitingForAgent: false,
      userCancelled: false,
      isLoadingHistory: false,
    }));

    const tasks = (lastThreadTasksPanelProps as { tasks?: Array<{ title?: string }> } | null)?.tasks ?? [];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Follow up");
  });
});
