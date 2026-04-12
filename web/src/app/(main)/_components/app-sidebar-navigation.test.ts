import { describe, expect, it } from "@jest/globals";
import { getRecentTaskNavigationDecision } from "./app-sidebar-navigation";

describe("getRecentTaskNavigationDecision", () => {
  it("routes a recent task click on the home screen to the conversation panel route", () => {
    expect(
      getRecentTaskNavigationDecision(null, "/", "conversation-1"),
    ).toEqual({
      nextPath: "/c/conversation-1",
      isAlreadyActive: false,
    });
  });

  it("routes a different recent task click from another conversation route", () => {
    expect(
      getRecentTaskNavigationDecision(
        "conversation-1",
        "/c/conversation-1",
        "conversation-2",
      ),
    ).toEqual({
      nextPath: "/c/conversation-2",
      isAlreadyActive: false,
    });
  });

  it("treats the current conversation route as already active", () => {
    expect(
      getRecentTaskNavigationDecision(
        "conversation-1",
        "/c/conversation-1",
        "conversation-1",
      ),
    ).toEqual({
      nextPath: "/c/conversation-1",
      isAlreadyActive: true,
    });
  });
});
