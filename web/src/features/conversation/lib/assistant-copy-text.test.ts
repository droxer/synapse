import { describe, expect, it } from "@jest/globals";
import { buildAssistantCopyText, isThinkingContentRedundantWithEntries } from "./assistant-copy-text";
import type { ChatMessage, PlanStep } from "@/shared/types";

const t = (key: string) => {
  const map: Record<string, string> = {
    "conversation.copySectionReasoning": "Reasoning",
    "conversation.copySectionAnswer": "Answer",
    "conversation.copySectionPlan": "Plan",
    "conversation.copySectionImages": "Images",
  };
  return map[key] ?? key;
};

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

describe("buildAssistantCopyText", () => {
  it("includes reasoning, answer, plan, and image URLs in order", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "Hello",
      timestamp: 1,
      thinkingEntries: [{ content: "step 1", timestamp: 0, durationMs: 0 }],
      thinkingContent: "extra",
    };
    const planSteps: PlanStep[] = [
      {
        name: "Research",
        description: "Look up docs",
        executionType: "parallel_worker",
        status: "complete",
      },
    ];
    const text = buildAssistantCopyText(msg, {
      hasEmbeddedPlan: true,
      planSteps,
      imageUrls: ["https://example.com/a.png"],
      t,
    });
    expect(text).toContain("Reasoning");
    expect(text).toContain("step 1");
    expect(text).toContain("extra");
    expect(text).toContain("Answer");
    expect(text).toContain("Hello");
    expect(text).toContain("Plan");
    expect(text).toContain("[complete] Research");
    expect(text).toContain("Images");
    expect(text).toContain("https://example.com/a.png");
    expect(text.indexOf("Reasoning")).toBeLessThan(text.indexOf("Answer"));
    expect(text.indexOf("Answer")).toBeLessThan(text.indexOf("Plan"));
    expect(text.indexOf("Plan")).toBeLessThan(text.indexOf("Images"));
  });

  it("omits redundant thinkingContent when it matches entries", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "Hi",
      timestamp: 1,
      thinkingEntries: [{ content: "same", timestamp: 0, durationMs: 0 }],
      thinkingContent: "same",
    };
    const text = buildAssistantCopyText(msg, {
      hasEmbeddedPlan: false,
      planSteps: [],
      imageUrls: [],
      t,
    });
    expect(text.match(/same/g)?.length).toBe(1);
  });
});
