import { describe, expect, it } from "@jest/globals";
import { parseThinkingTimeline } from "./parse-thinking-timeline";

describe("parseThinkingTimeline", () => {
  it("returns empty array for empty string", () => {
    expect(parseThinkingTimeline("")).toEqual([]);
  });

  it("returns single paragraph step when no headers", () => {
    expect(parseThinkingTimeline("Just some text.")).toEqual([
      { id: "step-1", title: "", body: "Just some text.", level: 0, type: "paragraph" },
    ]);
  });

  it("splits on ## headers", () => {
    const input = "## Step One\n\nBody one.\n\n## Step Two\n\nBody two.";
    const result = parseThinkingTimeline(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ title: "Step One", body: "Body one.", level: 2, type: "header" });
    expect(result[1]).toMatchObject({ title: "Step Two", body: "Body two.", level: 2, type: "header" });
  });

  it("handles mixed ## and ### headers", () => {
    const input = "## A\n\na\n\n### B\n\nb";
    const result = parseThinkingTimeline(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ title: "A", level: 2 });
    expect(result[1]).toMatchObject({ title: "B", level: 3 });
  });

  it("creates Context step for long leading preamble", () => {
    const preamble = "a".repeat(100);
    const input = `${preamble}\n\n## First\n\nbody`;
    const result = parseThinkingTimeline(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ title: "Context", type: "paragraph" });
    expect(result[1]).toMatchObject({ title: "First", type: "header" });
  });

  it("merges short leading preamble into first step", () => {
    const input = "Short.\n\n## First\n\nbody";
    const result = parseThinkingTimeline(input);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("First");
    expect(result[0].body).toContain("Short.");
    expect(result[0].body).toContain("body");
  });

  it("preserves inline markdown in header title", () => {
    const input = "## `code` and **bold**\n\nbody";
    const result = parseThinkingTimeline(input);
    expect(result[0].title).toBe("`code` and **bold**");
  });
});
