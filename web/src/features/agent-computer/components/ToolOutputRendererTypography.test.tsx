import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "output.toolFailed": "Tool failed",
        "conversation.retry": "Retry",
        "output.category.default": "Output",
        "output.category.mcp": "MCP",
        "output.agentResults": "Agent results",
        "output.agentMessages": "Agent messages",
        "output.agentMessageFrom": "From agent",
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ToolOutputRenderer } = require("./ToolOutputRenderer");

describe("ToolOutputRenderer typography", () => {
  it("keeps generic error prose at body size and metadata labels compact", () => {
    const html = renderToStaticMarkup(
      <ToolOutputRenderer
        output="The command failed because the file could not be parsed."
        toolName="web_search"
        success={false}
      />,
    );

    expect(html).toContain("text-sm leading-relaxed text-muted-foreground");
    expect(html).toContain("mt-1 text-sm text-muted-foreground");
    expect(html).toContain("border-destructive bg-card");
  });

  it("constrains tall output bodies inside a scrollable region", () => {
    const html = renderToStaticMarkup(
      <ToolOutputRenderer
        output={Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n")}
        toolName="web_fetch"
        success
      />,
    );

    expect(html).toContain("max-h-64");
    expect(html).toContain("overflow-auto");
    expect(html).toContain("overscroll-contain");
  });

  it("constrains code output bodies inside a scrollable region", () => {
    const html = renderToStaticMarkup(
      <ToolOutputRenderer
        output={Array.from({ length: 80 }, (_, i) => `print(${i})`).join("\n")}
        toolName="file_read"
        success
        contentType="text/x-python"
      />,
    );

    expect(html).toContain("max-h-64");
    expect(html).toContain("overflow-auto");
  });

  it("renders agent wait summaries through markdown", () => {
    const html = renderToStaticMarkup(
      <ToolOutputRenderer
        output={JSON.stringify({
          "agent-1": {
            success: true,
            summary: "**Done**\n\n- Checked tools\n\n| Item | Status |\n| --- | --- |\n| Tools | Checked |",
            error: null,
            artifacts: [],
          },
        })}
        toolName="agent_wait"
        success
      />,
    );

    expect(html).toContain("Agent results");
    expect(html).toContain("data-markdown=\"true\"");
    expect(html).toContain("**Done**");
    expect(html).toContain("| Item | Status |");
    expect(html).toContain("text-sm leading-relaxed text-muted-foreground");
    expect(html).toContain("[&amp;_ul]:my-1.5");
  });

  it("renders agent wait errors through markdown", () => {
    const html = renderToStaticMarkup(
      <ToolOutputRenderer
        output={JSON.stringify({
          "agent-1": {
            success: false,
            summary: "",
            error: "**Failed**\n\n```txt\nmissing result\n```",
            artifacts: [],
          },
        })}
        toolName="agent_wait"
        success
      />,
    );

    expect(html).toContain("Agent results");
    expect(html).toContain("data-markdown=\"true\"");
    expect(html).toContain("**Failed**");
    expect(html).toContain("missing result");
    expect(html).toContain("text-sm leading-relaxed text-muted-foreground");
    expect(html).toContain("[&amp;_code]:rounded");
  });

  it("renders received agent messages through markdown", () => {
    const html = renderToStaticMarkup(
      <ToolOutputRenderer
        output={JSON.stringify([
          {
            from: "agent-1",
            to: "parent",
            message: "Result:\n\n```ts\nconst ok = true;\n```",
          },
        ])}
        toolName="agent_receive"
        success
      />,
    );

    expect(html).toContain("Agent messages");
    expect(html).toContain("const ok = true");
    expect(html).toContain("[&amp;_code]:rounded");
  });

  it("keeps MCP tool text on the markdown fallback path", () => {
    const html = renderToStaticMarkup(
      <ToolOutputRenderer
        output={"### MCP result\n\n- item"}
        toolName="github__list_issues"
        success
      />,
    );

    expect(html).toContain("MCP");
    expect(html).toContain("### MCP result");
    expect(html).toContain("[&amp;_ol]:my-1.5");
  });
});
