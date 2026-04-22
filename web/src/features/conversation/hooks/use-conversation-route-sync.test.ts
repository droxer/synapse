import { describe, expect, it } from "@jest/globals";
import {
  getConversationIdFromPathname,
  getConversationRouteSyncPlan,
} from "./use-conversation-route-sync";

describe("getConversationIdFromPathname", () => {
  it("extracts conversation id from conversation routes", () => {
    expect(getConversationIdFromPathname("/c/123e4567")).toBe("123e4567");
  });

  it("supports nested conversation routes", () => {
    expect(getConversationIdFromPathname("/c/123e4567/metrics")).toBe("123e4567");
  });

  it("returns null for non-conversation routes", () => {
    expect(getConversationIdFromPathname("/")).toBeNull();
    expect(getConversationIdFromPathname("/skills")).toBeNull();
  });
});

describe("getConversationRouteSyncPlan", () => {
  it("resets stale conversation state on the home route", () => {
    expect(
      getConversationRouteSyncPlan("/", "conversation-1", null),
    ).toEqual({
      shouldResetConversation: true,
      switchConversationId: null,
      shouldResumeConversation: false,
      shouldClearPendingRoute: false,
    });
  });

  it("does not reset while a freshly created conversation is routing to /c/:id", () => {
    expect(
      getConversationRouteSyncPlan(
        "/",
        "conversation-1",
        "conversation-1",
      ),
    ).toEqual({
      shouldResetConversation: false,
      switchConversationId: null,
      shouldResumeConversation: false,
      shouldClearPendingRoute: false,
    });
  });

  it("switches and resumes when navigating to an existing conversation route", () => {
    expect(
      getConversationRouteSyncPlan(
        "/c/conversation-2",
        "conversation-1",
        null,
      ),
    ).toEqual({
      shouldResetConversation: false,
      switchConversationId: "conversation-2",
      shouldResumeConversation: true,
      shouldClearPendingRoute: false,
    });
  });

  it("clears the pending route marker once the target route is active", () => {
    expect(
      getConversationRouteSyncPlan(
        "/c/conversation-1",
        "conversation-1",
        "conversation-1",
      ),
    ).toEqual({
      shouldResetConversation: false,
      switchConversationId: null,
      shouldResumeConversation: false,
      shouldClearPendingRoute: true,
    });
  });

  it("does not auto-resume when already on the active conversation route", () => {
    expect(
      getConversationRouteSyncPlan(
        "/c/conversation-1",
        "conversation-1",
        null,
      ),
    ).toEqual({
      shouldResetConversation: false,
      switchConversationId: null,
      shouldResumeConversation: false,
      shouldClearPendingRoute: false,
    });
  });
});
