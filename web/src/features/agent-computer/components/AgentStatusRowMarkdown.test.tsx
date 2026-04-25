import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { HTMLAttributes, ReactNode } from "react";
import type { AgentStatus, ToolCallInfo } from "@/shared/types";

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
        "computer.agentSummary": "Summary",
        "a11y.agentToolProgress": `${params?.completed ?? 0}/${params?.total ?? 0} tools complete`,
        "a11y.expandAgentTools": `Expand tools for ${params?.agent ?? ""}: ${params?.progress ?? ""}`,
        "a11y.collapseAgentTools": `Collapse tools for ${params?.agent ?? ""}: ${params?.progress ?? ""}`,
      };
      return dict[key] ?? key;
    },
  }),
}));

jest.mock("@/shared/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content, className }: { readonly content: string; readonly className?: string }) => (
    <div data-markdown="true" className={className}>{content}</div>
  ),
}));

jest.mock("./ToolOutputRenderer", () => ({
  ToolOutputRenderer: () => null,
}));

jest.mock("./ToolArgsDisplay", () => ({
  ToolArgsDisplay: () => null,
}));

jest.mock("./SkillActivityEntry", () => ({
  SkillActivityEntry: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AgentStatusRow } = require("./AgentStatusRow");

describe("AgentStatusRow markdown", () => {
  it("renders agent completion summaries through markdown", () => {
    const agent: AgentStatus = {
      agentId: "agent-1",
      name: "Research Agent",
      description: "Collect device data",
      status: "complete",
      timestamp: 1,
      summary: "**Done**\n\n| Brand | Status |\n| --- | --- |\n| Xiaomi | Complete |",
    };

    const html = renderToStaticMarkup(<AgentStatusRow agent={agent} />);

    expect(html).toContain("Summary");
    expect(html).toContain("data-markdown=\"true\"");
    expect(html).toContain("| Brand | Status |");
    expect(html).toContain("[&amp;_code]:rounded");
  });

  it("names expandable tool rows with the subagent and tool progress", () => {
    const agent: AgentStatus = {
      agentId: "agent-1",
      name: "Research Agent",
      description: "Collect device data",
      status: "complete",
      timestamp: 1,
    };
    const toolCalls: ToolCallInfo[] = [
      {
        id: "tc-1",
        toolUseId: "tool-1",
        name: "web_search",
        input: { query: "devices" },
        timestamp: 2,
        output: "ok",
        agentId: "agent-1",
      },
      {
        id: "tc-2",
        toolUseId: "tool-2",
        name: "file_read",
        input: { path: "README.md" },
        timestamp: 3,
        agentId: "agent-1",
      },
    ];

    const html = renderToStaticMarkup(<AgentStatusRow agent={agent} toolCalls={toolCalls} />);

    expect(html).toContain("aria-label=\"Expand tools for Research Agent: 1/2 tools complete\"");
  });
});
