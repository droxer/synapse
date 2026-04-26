import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "inputPrompt.title": "Agent needs your input",
        "inputPrompt.subtitle": "Please respond to continue",
        "channels.prompt.chooseOption": "Choose an option to continue.",
      };
      return dict[key] ?? key;
    },
  }),
}));

jest.mock("@/shared/hooks", () => ({
  useSSE: () => ({ events: [], isConnected: true, clearLastTurn: jest.fn() }),
  useSessionFilteredArtifacts: (artifacts: unknown) => artifacts,
}));

jest.mock("@/features/conversation/hooks/use-conversation-transcript", () => ({
  useConversationTranscript: () => ({
    effectiveEvents: [],
    messages: [],
    artifacts: [],
    agentState: {
      toolCalls: [],
      taskState: "idle",
      agentStatuses: [],
      planSteps: [],
      currentThinkingEntries: [],
      isStreaming: false,
      assistantPhase: { phase: "idle" },
    },
  }),
}));

jest.mock("@/features/conversation/api/history-api", () => ({
  fetchMessages: jest.fn(),
  fetchEvents: jest.fn(),
  fetchArtifacts: jest.fn(),
}));

jest.mock("@/features/conversation/api/conversation-api", () => ({
  sendFollowUpMessage: jest.fn(),
  cancelTurn: jest.fn(),
  retryTurn: jest.fn(),
}));

jest.mock("@/features/conversation/hooks/use-conversation-history", () => ({
  resolveConversationHistoryResults: () => ({
    messages: [],
    events: [],
    artifacts: [],
  }),
}));

jest.mock("@/features/conversation", () => ({
  ConversationWorkspace: (props: {
    inputDisabled?: boolean;
    inputDisabledPlaceholder?: string;
  }) => (
    <div
      data-testid="workspace"
      data-input-disabled={props.inputDisabled ? "true" : "false"}
      data-input-disabled-placeholder={props.inputDisabledPlaceholder ?? ""}
    />
  ),
  usePendingAsk: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { usePendingAsk } = require("@/features/conversation");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ChannelChatView } = require("./ChannelChatView");

describe("ChannelChatView pending ask controls", () => {
  it("renders ask options and disables freeform input when freeform is not allowed", () => {
    usePendingAsk.mockReturnValue({
      pendingAsk: {
        requestId: "ask-1",
        title: "Pick a path",
        question: "Which route should the agent take?",
        options: [
          { label: "Approve", value: "approve", description: "Continue with the plan." },
          { label: "Revise", value: "revise" },
        ],
        allowFreeform: false,
      },
      handlePromptSubmit: jest.fn(),
      respondError: null,
    });

    const html = renderToStaticMarkup(createElement(ChannelChatView, {
      conversation: {
        conversation_id: "conversation-1",
        provider: "telegram",
        display_name: "Design chat",
        provider_chat_id: "chat-1",
        last_message: null,
        last_message_at: null,
        session_active: true,
      },
      hideTopBar: true,
    }));

    expect(html).toContain("Pick a path");
    expect(html).toContain("Approve");
    expect(html).toContain("Continue with the plan.");
    expect(html).toContain("Choose an option to continue.");
    expect(html).toContain("data-input-disabled=\"true\"");
  });
});
