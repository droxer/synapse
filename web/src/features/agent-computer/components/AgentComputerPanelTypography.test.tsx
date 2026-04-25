import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { HTMLAttributes, ReactNode } from "react";

interface MockDivProps extends HTMLAttributes<HTMLDivElement> {
  readonly children?: ReactNode;
}

interface MockSpanProps extends HTMLAttributes<HTMLSpanElement> {
  readonly children?: ReactNode;
}

interface MockNodeProps {
  readonly children?: ReactNode;
}

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: MockDivProps) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: MockSpanProps) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: MockNodeProps) => <>{children}</>,
}));

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        "computer.title": "Computer",
        "computer.tabsLabel": "Panel tabs",
        "computer.activity": "Activity",
        "computer.artifacts": "Files",
        "computer.broadcastMessage": "Broadcast message",
        "computer.thinkingReadMore": "Read more",
        "computer.thinkingCollapse": "Collapse",
        "computer.statusDone": "Done",
        "computer.statusLive": "Live",
        "computer.statusIdle": "Idle",
        "computer.statusError": "Error",
        "computer.running": "Running",
        "computer.usingTool": `Using ${params?.verb ?? ""}`,
        "computer.usingToolGeneric": `Using ${params?.name ?? ""}`,
        "computer.spawningAgent": `Spawning ${params?.name ?? ""}`,
        "computer.sendToAgent": `Sending to ${params?.id ?? ""}`,
        "tools.verb.web_search": "search",
        "conversation.retry": "Retry",
      };
      return dict[key] ?? key;
    },
  }),
}));

jest.mock("@/shared/hooks", () => ({
  useStickyBottom: () => undefined,
}));

jest.mock("./ArtifactFilesPanel", () => ({
  ArtifactFilesPanel: () => null,
}));

jest.mock("@/shared/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content, className }: { readonly content: string; readonly className?: string }) => (
    <div className={className}>{content}</div>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AgentComputerPanel } = require("./AgentComputerPanel");

describe("AgentComputerPanel typography", () => {
  it("renders descriptive activity prose at body text size while keeping metadata compact", () => {
    const toolCalls = [
      {
        id: "spawn-1",
        toolUseId: "spawn-1",
        name: "agent_spawn",
        input: {
          name: "Docs Agent",
          role: "research",
          task_description: "Investigate the issue and summarize the result for the parent agent.",
        },
        timestamp: 1,
        success: true,
      },
      {
        id: "send-1",
        toolUseId: "send-1",
        name: "agent_send",
        input: {
          agent_id: "agent-1",
          message: "Please verify typography consistency in the activity panel.",
        },
        timestamp: 2,
        success: true,
      },
      {
        id: "tool-1",
        toolUseId: "tool-1",
        name: "web_search",
        input: {
          query: "typography system",
        },
        thinkingText: "Reviewing the latest tool activity entry before rendering the row. ".repeat(4),
        timestamp: 3,
        agentId: "agent-1",
      },
    ];

    const html = renderToStaticMarkup(
      <AgentComputerPanel
        conversationId="conv-1"
        toolCalls={toolCalls}
        agentStatuses={[]}
        artifacts={[]}
        taskState="executing"
      />,
    );

    expect(html).toContain("mt-1 text-sm leading-relaxed text-muted-foreground");
    expect(html).toContain("text-sm italic leading-relaxed text-muted-foreground");
    expect(html).toContain("ml-1 rounded text-sm text-muted-foreground");
    expect(html).toContain("truncate text-micro text-muted-foreground");
    expect(html).toContain("label-mono");
    expect(html).toContain("data-agent-tool-owner=\"agent-1\"");
    expect(html).toContain("data-agent-tool-anchor=\"true\"");
  });
});
