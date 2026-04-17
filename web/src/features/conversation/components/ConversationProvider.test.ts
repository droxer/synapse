import { describe, expect, it } from "@jest/globals";
import { shouldConnectConversationEvents } from "./conversation-event-connection";

describe("shouldConnectConversationEvents", () => {
  it("does not connect without a conversation id", () => {
    expect(shouldConnectConversationEvents(null, true, false, null)).toBe(false);
  });

  it("does not connect for non-live conversations", () => {
    expect(shouldConnectConversationEvents("c1", false, false, null)).toBe(false);
  });

  it("allows immediate SSE for a newly created pending route", () => {
    expect(shouldConnectConversationEvents("c1", true, true, "c1")).toBe(true);
  });

  it("waits for history validation on restored live conversations", () => {
    expect(shouldConnectConversationEvents("c1", true, true, null)).toBe(false);
    expect(shouldConnectConversationEvents("c1", true, false, null)).toBe(true);
  });
});
