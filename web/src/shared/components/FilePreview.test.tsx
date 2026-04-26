import type React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock("@/shared/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

jest.mock("@/shared/components/ui/skeleton", () => ({
  Skeleton: () => <div>Skeleton</div>,
}));

jest.mock("@/shared/components/ui/code-output", () => ({
  CodeOutput: ({ output }: { output: string }) => <pre>{output}</pre>,
}));

jest.mock("@/shared/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <article data-testid="markdown-preview">{content}</article>
  ),
}));

async function renderWithState(
  contentState:
    | { status: "idle" }
    | { status: "ready"; html?: string; text?: string }
    | {
        status: "ppt-ready";
        manifest: {
          kind: "slides";
          file_name: string;
          slide_count: number;
          slides: readonly { index: number; image_url: string }[];
        };
      },
  props: {
    readonly url: string;
    readonly contentType: string;
    readonly fileName: string;
  },
): Promise<string> {
  jest.doMock("react", () => {
    const actual = jest.requireActual<typeof import("react")>("react");
    return {
      ...actual,
      useState: jest
        .fn()
        .mockImplementationOnce(() => [contentState, jest.fn()])
        .mockImplementationOnce(() => [false, jest.fn()]),
    };
  });

  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { FilePreview } = await import("./FilePreview");

  return renderToStaticMarkup(React.createElement(FilePreview, props));
}

afterEach(() => {
  jest.resetModules();
  jest.unmock("react");
});

describe("FilePreview", () => {
  it("renders PPT slide previews from the server manifest state", async () => {
    const html = await renderWithState(
      {
        status: "ppt-ready",
        manifest: {
          kind: "slides",
          file_name: "deck.pptx",
          slide_count: 2,
          slides: [
            { index: 1, image_url: "/api/conversations/c1/artifacts/a1/preview/slides/1" },
            { index: 2, image_url: "/api/conversations/c1/artifacts/a1/preview/slides/2" },
          ],
        },
      },
      {
        url: "/api/conversations/c1/artifacts/a1",
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        fileName: "deck.pptx",
      },
    );

    expect(html).toContain("Slide 1");
    expect(html).toContain("preview/slides/1");
    expect(html).toContain("preview/slides/2");
  });

  it("treats pptx extension as previewable even with a generic mime type", async () => {
    const html = await renderWithState(
      {
        status: "ppt-ready",
        manifest: {
          kind: "slides",
          file_name: "deck.pptx",
          slide_count: 1,
          slides: [
            { index: 1, image_url: "/api/conversations/c1/artifacts/a1/preview/slides/1" },
          ],
        },
      },
      {
        url: "/api/conversations/c1/artifacts/a1",
        contentType: "application/octet-stream",
        fileName: "deck.pptx",
      },
    );

    expect(html).toContain("Slide 1");
    expect(html).toContain("preview/slides/1");
  });

  it("renders DOCX HTML when office conversion content is ready", async () => {
    const html = await renderWithState(
      { status: "ready", html: "<h1>Doc</h1>" },
      {
        url: "/api/conversations/c1/artifacts/a1",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: "report.docx",
      },
    );

    expect(html).toContain("iframe");
    expect(html).toContain("&lt;h1&gt;Doc&lt;/h1&gt;");
  });

  it("renders PDF in an iframe branch", async () => {
    const html = await renderWithState(
      { status: "idle" },
      {
        url: "/api/conversations/c1/artifacts/a1",
        contentType: "application/pdf",
        fileName: "report.pdf",
      },
    );

    expect(html).toContain("iframe");
    expect(html).toContain("inline=1");
  });

  it("renders markdown text through the markdown preview branch", async () => {
    const html = await renderWithState(
      { status: "ready", text: "# Report\n\n## Findings\n\n- Done" },
      {
        url: "/api/conversations/c1/artifacts/a1",
        contentType: "text/markdown",
        fileName: "report.md",
      },
    );

    expect(html).toContain("data-testid=\"markdown-preview\"");
    expect(html).toContain("# Report");
    expect(html).not.toContain("<pre>");
  });
});
