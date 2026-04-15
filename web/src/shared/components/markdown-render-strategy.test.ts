import { describe, expect, it } from "@jest/globals";
import { getMarkdownRenderStrategy, splitStreamingMarkdown } from "./markdown-render-strategy";

describe("markdown render strategy", () => {
  it("uses the hybrid streaming strategy for in-flight content", () => {
    expect(getMarkdownRenderStrategy(true)).toBe("streaming-hybrid");
  });

  it("uses the settled strategy after streaming ends", () => {
    expect(getMarkdownRenderStrategy(false)).toBe("settled");
  });
});

describe("splitStreamingMarkdown", () => {
  it("keeps completed blocks parsed while leaving the trailing paragraph lightweight", () => {
    expect(
      splitStreamingMarkdown("# Title\n\n- one\n- two\n\nTrailing paragraph"),
    ).toEqual({
      stableContent: "# Title\n\n- one\n- two\n\n",
      tailContent: "Trailing paragraph",
    });
  });

  it("keeps an unmatched fenced code block in the lightweight tail", () => {
    expect(
      splitStreamingMarkdown("Intro\n\n```ts\nconst x = 1;"),
    ).toEqual({
      stableContent: "Intro\n\n",
      tailContent: "```ts\nconst x = 1;",
    });
  });

  it("keeps a trailing table block lightweight until it is terminated", () => {
    expect(
      splitStreamingMarkdown("Summary\n\n| Name | Value |\n| --- | --- |\n| A | 1 |"),
    ).toEqual({
      stableContent: "Summary\n\n",
      tailContent: "| Name | Value |\n| --- | --- |\n| A | 1 |",
    });
  });

  it("keeps the trailing list block lightweight when the stream ends mid-list", () => {
    expect(
      splitStreamingMarkdown("Intro\n\n- one\n- two"),
    ).toEqual({
      stableContent: "Intro\n\n",
      tailContent: "- one\n- two",
    });
  });
});
