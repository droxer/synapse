import { describe, expect, it } from "@jest/globals";
import {
  shouldAutoStartPendingTask,
  shouldShowConversationWorkspace,
} from "./conversation-view-state";

describe("shouldShowConversationWorkspace", () => {
  it("shows the workspace immediately while waiting for a new conversation to start", () => {
    expect(shouldShowConversationWorkspace(null, true)).toBe(true);
  });

  it("shows the workspace for an existing conversation", () => {
    expect(shouldShowConversationWorkspace("conversation-1", false)).toBe(true);
  });

  it("keeps the welcome screen when there is no active or pending conversation", () => {
    expect(shouldShowConversationWorkspace(null, false)).toBe(false);
  });
});

describe("shouldAutoStartPendingTask", () => {
  it("starts a queued task on the home route before any conversation is active", () => {
    expect(
      shouldAutoStartPendingTask({
        pathname: "/",
        pendingNewTask: { prompt: "Build a website" },
        isActive: false,
      }),
    ).toBe(true);
  });

  it("does not start a queued task again after the workspace is already active", () => {
    expect(
      shouldAutoStartPendingTask({
        pathname: "/",
        pendingNewTask: { prompt: "Build a website" },
        isActive: true,
      }),
    ).toBe(false);
  });

  it("does not auto-start queued tasks on non-home routes", () => {
    expect(
      shouldAutoStartPendingTask({
        pathname: "/skills",
        pendingNewTask: { prompt: "Build a website" },
        isActive: false,
      }),
    ).toBe(false);
  });
});
