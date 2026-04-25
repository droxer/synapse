import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "output.toolFailed": "Tool failed",
        "conversation.retry": "Retry",
        "output.category.default": "Output",
      };
      return dict[key] ?? key;
    },
  }),
}));

jest.mock("@/shared/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content, className }: { readonly content: string; readonly className?: string }) => (
    <div className={className}>{content}</div>
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
});
