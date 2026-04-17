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
  it("parses live markdown blocks by default while streaming", () => {
    expect(
      splitStreamingMarkdown("# Title\n\n- one\n- two\n\nTrailing paragraph"),
    ).toEqual({
      stableContent: "# Title\n\n- one\n- two\n\nTrailing paragraph",
      tailContent: "",
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

  it("parses tables live while streaming", () => {
    expect(
      splitStreamingMarkdown("Summary\n\n| Name | Value |\n| --- | --- |\n| A | 1 |"),
    ).toEqual({
      stableContent: "Summary\n\n| Name | Value |\n| --- | --- |\n| A | 1 |",
      tailContent: "",
    });
  });

  it("parses lists live while streaming", () => {
    expect(
      splitStreamingMarkdown("Intro\n\n- one\n- two"),
    ).toEqual({
      stableContent: "Intro\n\n- one\n- two",
      tailContent: "",
    });
  });

  it("keeps an unmatched inline code span in the lightweight tail", () => {
    expect(
      splitStreamingMarkdown("Intro with `partial"),
    ).toEqual({
      stableContent: "Intro with ",
      tailContent: "`partial",
    });
  });

  it("keeps an unfinished markdown link in the lightweight tail", () => {
    expect(
      splitStreamingMarkdown("Intro [OpenAI](https://example.com"),
    ).toEqual({
      stableContent: "Intro ",
      tailContent: "[OpenAI](https://example.com",
    });
  });

  it("keeps a trailing emphasis opener in the lightweight tail", () => {
    expect(
      splitStreamingMarkdown("Intro **partial"),
    ).toEqual({
      stableContent: "Intro ",
      tailContent: "**partial",
    });
  });
});
