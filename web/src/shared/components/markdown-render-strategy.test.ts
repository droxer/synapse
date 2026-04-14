import { describe, expect, it } from "@jest/globals";
import { getMarkdownRenderStrategy } from "./markdown-render-strategy";

describe("markdown render strategy", () => {
  it("uses the lightweight streaming strategy for in-flight content", () => {
    expect(getMarkdownRenderStrategy(true)).toBe("streaming-light");
  });

  it("uses the settled strategy after streaming ends", () => {
    expect(getMarkdownRenderStrategy(false)).toBe("settled");
  });
});
