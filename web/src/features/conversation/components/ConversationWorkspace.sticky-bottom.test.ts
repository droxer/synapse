import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const useStickyBottomMock = jest.fn();

jest.mock("@/i18n", () => ({
  __esModule: true,
  useTranslation: () => ({
    locale: "en",
    setLocale: () => undefined,
    t: (key: string) => key,
    tArray: (key: string) => [key],
  }),
}));

jest.mock("framer-motion", () => ({
  __esModule: true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => createElement(React.Fragment, null, children),
  MotionConfig: ({ children }: { children: React.ReactNode }) => createElement(React.Fragment, null, children),
  motion: {
    div: ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) =>
      createElement("div", props, children),
    span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => createElement("span", props, children),
  },
  useReducedMotion: () => true,
}));

jest.mock("@/shared/hooks", () => ({
  __esModule: true,
  useStickyBottom: (...args: unknown[]) => useStickyBottomMock(...args),
}));

jest.mock("@/shared/components", () => ({
  __esModule: true,
  TopBar: () => null,
  MarkdownRenderer: ({
    content,
  }: {
    content: string;
  }) => createElement("div", { "data-testid": "markdown" }, content),
}));

jest.mock("@/shared/components/EmptyState", () => ({
  __esModule: true,
  EmptyState: () => null,
}));

jest.mock("@/shared/components/ui/tooltip", () => ({
  __esModule: true,
  Tooltip: ({ children }: { children: React.ReactNode }) => createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => createElement(React.Fragment, null, children),
  TooltipContent: () => null,
}));

jest.mock("@/features/agent-computer", () => ({
  __esModule: true,
  AgentProgressCard: () => null,
  AgentComputerPanel: () => null,
}));

jest.mock("./ThreadTasksPanel", () => ({
  __esModule: true,
  ThreadTasksPanel: () => null,
}));

jest.mock("@/features/conversation", () => ({
  __esModule: true,
  ChatInput: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ConversationWorkspace } = require("./ConversationWorkspace");

describe("ConversationWorkspace sticky bottom wiring", () => {
  it("delegates transcript following to the shared sticky-bottom hook", () => {
    useStickyBottomMock.mockReset();

    renderToStaticMarkup(createElement(ConversationWorkspace, {
      conversationId: "c1",
      conversationTitle: "Test",
      events: [],
      messages: [
        {
          messageId: "event-turn:1:assistant:0",
          role: "assistant",
          content: "Streaming reply",
          timestamp: 100,
          source: "event",
          turnId: "event-turn:1",
        },
      ],
      toolCalls: [],
      agentStatuses: [],
      planSteps: [],
      artifacts: [],
      taskState: "executing",
      currentThinkingEntries: [],
      isStreaming: true,
      assistantPhase: { phase: "writing" },
      isConnected: true,
      onSendMessage: () => undefined,
      isWaitingForAgent: false,
      userCancelled: false,
      isLoadingHistory: false,
    }));

    expect(useStickyBottomMock).toHaveBeenCalledTimes(1);
    expect(useStickyBottomMock.mock.calls[0]?.[1]).toEqual({ enabled: true });
  });
});
