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
    expect(html).toContain(">Title</span>");
    expect(html).toContain(">•</span>");
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

  it("defaults isStreaming to hybrid rendering so stable markdown blocks stay parsed", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"# Title\n\n- one\n- two\n\nTrailing paragraph"}
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).toContain("# Title");
    expect(html).toContain("- one");
    expect(html).toContain("Trailing paragraph");
  });

  it("renders stable markdown blocks including the trailing paragraph in hybrid mode", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"# Title\n\n- one\n- two\n\nTrailing paragraph"}
        mode="streaming-hybrid"
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).toContain("# Title");
    expect(html).toContain("- one");
    expect(html).toContain("Trailing paragraph");
  });

  it("keeps an unmatched fenced code block entirely in the lightweight tail (hybrid split)", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"Intro\n\n```ts\nconst x = 1;"}
        mode="streaming-hybrid"
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).toContain("Intro");
    expect(html).toContain("markdown-streaming-tail");
    expect(html).toContain("ts");
    expect(html).toContain("const x = 1;");
  });

  it("keeps a trailing list block lightweight until the stream finishes the block (hybrid)", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"Intro\n\n- one\n- two"}
        mode="streaming-hybrid"
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).toContain("Intro");
    expect(html).not.toContain("markdown-streaming-tail");
    expect(html).toContain("- one");
    expect(html).toContain("- two");
  });

  it("renders completed inline markdown directly in parsed output", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"Visit [docs](https://example.com) and **pay attention**."}
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).toContain("Visit [docs](https://example.com) and **pay attention**.");
    expect(html).not.toContain("markdown-streaming-tail");
  });

  it("keeps an unfinished chunk-split link as raw lightweight tail text until it closes (hybrid)", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"Visit [docs](https://example"}
        mode="streaming-hybrid"
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).toContain("Visit ");
    expect(html).toContain("markdown-streaming-tail");
    expect(html).toContain("[docs](https://example");
    expect(html).not.toContain(">docs</a>");
  });

  it("promotes the paragraph into parsed markdown once the block is closed (hybrid)", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"Visit [docs](https://example.com) and **pay attention**.\n\n"}
        mode="streaming-hybrid"
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).not.toContain("markdown-streaming-tail");
  });

  it("renders heading markers in the lightweight tail without showing raw hashes", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"## Comparison"}
        mode="streaming-light"
        isStreaming
      />,
    );

    expect(html).toContain("Comparison");
    expect(html).not.toContain("## Comparison");
    expect(html).toContain("markdown-streaming-tail");
  });

  it("renders fenced code blocks in streaming-light mode", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"```ts\nconst x = 1;\n```"}
        mode="streaming-light"
        isStreaming
      />,
    );

    expect(html).toContain("ts");
    expect(html).toContain("const x = 1;");
    expect(html).not.toContain("```");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("rounded-xl");
  });

  it("renders tables in streaming-light mode", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"| A | B |\n|---|---|\n| 1 | 2 |"}
        mode="streaming-light"
        isStreaming
      />,
    );

    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("A");
    expect(html).toContain("B");
    expect(html).toContain("1");
    expect(html).toContain("2");
    expect(html).not.toContain("|---|");
  });

  it("keeps a plain CJK paragraph in parsed output while streaming", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"你好，世界"}
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).not.toContain("markdown-streaming-tail");
    expect(html).toContain("你好，世界");
  });

  it("promotes a closed CJK paragraph into parsed markdown (hybrid)", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={"你好，世界\n\n"}
        mode="streaming-hybrid"
        isStreaming
      />,
    );

    expect(html).toContain('data-testid="parsed-markdown"');
    expect(html).not.toContain("markdown-streaming-tail");
    expect(html).toContain("你好，世界");
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
