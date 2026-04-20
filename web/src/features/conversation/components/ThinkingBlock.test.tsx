import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("framer-motion", () => {
  return {
    __esModule: true,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
      span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
    },
    useReducedMotion: () => true,
  };
});

jest.mock("@/shared/components", () => ({
  __esModule: true,
  MarkdownRenderer: ({
    content,
    className,
  }: {
    content: string;
    className?: string;
  }) => <div className={className} data-testid="markdown-reasoning">{content}</div>,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThinkingBlock, getNextThinkingBlockExpanded } = require("./ThinkingBlock");

describe("ThinkingBlock", () => {
  it("renders expanded by default while thinking is live", () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        content="Working through the prompt."
        isThinking
        isTurnStreaming
        durationMs={1800}
      />,
    );

    expect(html).toContain("data-thinking-panel");
    expect(html).toContain("thinking.thinking");
    expect(html).toContain("Working through the prompt.");
  });

  it("auto-collapses once the streaming turn settles", () => {
    expect(getNextThinkingBlockExpanded(true, true, false)).toBe(false);
    expect(getNextThinkingBlockExpanded(true, true, true)).toBe(true);
    expect(getNextThinkingBlockExpanded(false, false, false)).toBe(false);
  });

  it("renders single-paragraph reasoning without a timeline list", () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        content="A compact reasoning note."
        isThinking={false}
        isTurnStreaming={false}
        durationMs={2200}
      />,
    );

    expect(html).toContain("A compact reasoning note.");
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("data-thinking-step=");
  });

  it("renders headed reasoning as stacked steps with disclosure content", () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        content={"## Inspect\n\nCheck constraints.\n\n## Decide\n\nChoose the safest path."}
        isThinking
        isTurnStreaming
        durationMs={3200}
      />,
    );

    expect(html).toContain('data-thinking-mode="steps"');
    expect(html).toContain('data-thinking-step="1"');
    expect(html).toContain('data-thinking-step="2"');
    expect(html).toContain("Inspect");
    expect(html).toContain("Decide");
  });

  it("uses summaryLabel instead of the duration label when provided", () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        content="Inline extracted reasoning."
        isThinking={false}
        isTurnStreaming={false}
        durationMs={5000}
        summaryLabel="Reasoning"
      />,
    );

    expect(html).toContain("Reasoning");
    expect(html).not.toContain("Thought for 5s");
  });

  it("uses the generic reasoning label when no duration was provided", () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        content="Reasoning without duration metadata."
        isThinking={false}
        isTurnStreaming={false}
        durationMs={0}
      />,
    );

    expect(html).toContain("thinking.reasoning");
    expect(html).not.toContain("Thought for 1s");
  });
});
