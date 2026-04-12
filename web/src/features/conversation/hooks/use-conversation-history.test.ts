import { describe, expect, it } from "@jest/globals";
import { isConversationHistoryLoading } from "./use-conversation-history";

describe("isConversationHistoryLoading", () => {
  it("treats a newly selected conversation as loading before the fetch effect settles", () => {
    expect(
      isConversationHistoryLoading("conversation-1", null, false),
    ).toBe(true);
  });

  it("stays loading while an in-flight history request is running", () => {
    expect(
      isConversationHistoryLoading("conversation-1", "conversation-1", true),
    ).toBe(true);
  });

  it("stops loading once the selected conversation has finished loading", () => {
    expect(
      isConversationHistoryLoading("conversation-1", "conversation-1", false),
    ).toBe(false);
  });

  it("does not report loading when no conversation is selected", () => {
    expect(isConversationHistoryLoading(null, null, false)).toBe(false);
  });
});
