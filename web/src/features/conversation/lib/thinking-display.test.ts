import { describe, expect, it } from "@jest/globals";
import { isThinkingContentRedundantWithEntries, selectThinkingDisplay } from "./thinking-display";

describe("isThinkingContentRedundantWithEntries", () => {
  it("returns false when thinkingContent is missing", () => {
    expect(isThinkingContentRedundantWithEntries(undefined, [{ content: "a" }])).toBe(false);
  });

  it("returns true when content matches joined entries", () => {
    expect(
      isThinkingContentRedundantWithEntries("a\n\nb", [
        { content: "a" },
        { content: "b" },
      ]),
    ).toBe(true);
  });
});

describe("selectThinkingDisplay", () => {
  it("prefers localized Chinese thinking content over English entries", () => {
    const result = selectThinkingDisplay(
      "zh-CN",
      [{ content: "The user wants me to organize the technical research report." }],
      "用户希望我整理这份技术研究报告。",
    );

    expect(result.entries).toEqual([]);
    expect(result.thinkingContent).toBe("用户希望我整理这份技术研究报告。");
  });

  it("keeps non-redundant thinking content when locale heuristic does not apply", () => {
    const result = selectThinkingDisplay(
      "en",
      [{ content: "step 1" }],
      "extra",
    );

    expect(result.entries).toEqual([{ content: "step 1" }]);
    expect(result.thinkingContent).toBe("extra");
  });
});
