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

  it("keeps completed links and emphasis fully parsed while streaming", () => {
    expect(
      splitStreamingMarkdown("Visit [docs](https://example.com) and **pay attention**."),
    ).toEqual({
      stableContent: "",
      tailContent: "Visit [docs](https://example.com) and **pay attention**.",
    });
  });

  it("keeps completed emphasis with trailing punctuation fully parsed", () => {
    expect(
      splitStreamingMarkdown("Keep *moving*."),
    ).toEqual({
      stableContent: "",
      tailContent: "Keep *moving*.",
    });
  });

  it("keeps completed inline code with trailing text fully parsed", () => {
    expect(
      splitStreamingMarkdown("Use `npm test` before merging."),
    ).toEqual({
      stableContent: "",
      tailContent: "Use `npm test` before merging.",
    });
  });

  it("keeps a truly partial single-emphasis span in the lightweight tail", () => {
    expect(
      splitStreamingMarkdown("Keep *moving"),
    ).toEqual({
      stableContent: "Keep ",
      tailContent: "*moving",
    });
  });

  it("keeps a single in-progress paragraph in the lightweight tail", () => {
    expect(
      splitStreamingMarkdown("A plain streaming paragraph"),
    ).toEqual({
      stableContent: "",
      tailContent: "A plain streaming paragraph",
    });
  });

  it("keeps a plain CJK paragraph in the lightweight tail while it is still open", () => {
    expect(
      splitStreamingMarkdown("你好，世界"),
    ).toEqual({
      stableContent: "",
      tailContent: "你好，世界",
    });
  });

  it("promotes a paragraph once a blank line closes it", () => {
    expect(
      splitStreamingMarkdown("First paragraph\n\n"),
    ).toEqual({
      stableContent: "First paragraph\n\n",
      tailContent: "",
    });
  });

  it("promotes a CJK paragraph once a blank line closes it", () => {
    expect(
      splitStreamingMarkdown("你好，世界\n\n"),
    ).toEqual({
      stableContent: "你好，世界\n\n",
      tailContent: "",
    });
  });
});
