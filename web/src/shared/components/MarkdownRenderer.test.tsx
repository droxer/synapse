import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => (
    <div data-testid="parsed-markdown">{children}</div>
  ),
}));

jest.mock("remark-gfm", () => ({
  __esModule: true,
  default: () => undefined,
}));

jest.mock("remark-math", () => ({
  __esModule: true,
  default: () => undefined,
}));

jest.mock("rehype-katex", () => ({
  __esModule: true,
  default: () => undefined,
}));

jest.mock("rehype-highlight", () => ({
  __esModule: true,
  default: () => undefined,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MarkdownRenderer } = require("./MarkdownRenderer");

describe("MarkdownRenderer", () => {
  it("renders with the lightweight streaming mode while assistant content streams", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"# Title\n\n- one\n- two\n\n`inline`"}
        mode="streaming-light"
        isStreaming
      />,
    );

    expect(html).not.toContain('data-testid="parsed-markdown"');
    expect(html).toContain("streaming-active");
    expect(html).toContain("<code");
    expect(html).toContain("# Title");
    expect(html).toContain("markdown-streaming-tail");
  });

  it("renders full markdown once content is settled", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"# Title\n\n- one\n- two\n\n`inline`"}
        mode="settled"
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
  });

  it("renders stable markdown blocks while keeping the trailing paragraph lightweight during streaming", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"# Title\n\n- one\n- two\n\nTrailing paragraph"}
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).toContain("# Title");
    expect(html).toContain("- one");
    expect(html).toContain("markdown-streaming-tail");
    expect(html).toContain("Trailing paragraph");
  });

  it("keeps an unmatched fenced code block entirely in the lightweight tail", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"Intro\n\n```ts\nconst x = 1;"}
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).toContain("Intro");
    expect(html).toContain("markdown-streaming-tail");
    expect(html).toContain("```ts");
    expect(html).toContain("const x = 1;");
  });

  it("keeps a trailing list block lightweight until the stream finishes the block", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"Intro\n\n- one\n- two"}
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).toContain("Intro");
    expect(html).toContain("markdown-streaming-tail");
    expect(html).toContain("- one");
    expect(html).toContain("- two");
  });
});

describe("streaming cursor CSS", () => {
  it("targets the lightweight streaming tail for ordinary text streams", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(css).toContain(".markdown-body.streaming-active > .markdown-streaming-tail:last-child::after");
  });
});
