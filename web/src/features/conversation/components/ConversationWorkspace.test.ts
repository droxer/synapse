import { describe, expect, it } from "@jest/globals";
import { shouldAutoScrollToBottom } from "./conversation-scroll";

describe("shouldAutoScrollToBottom", () => {
  it("scrolls on first populate", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 0,
        nextActivityCount: 1,
        distanceFromBottom: 999,
      }),
    ).toBe(true);
  });

  it("does not scroll when there is no new activity", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 5,
        nextActivityCount: 5,
        distanceFromBottom: 10,
      }),
    ).toBe(false);
  });

  it("scrolls when new activity arrives near bottom", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 5,
        nextActivityCount: 6,
        distanceFromBottom: 60,
      }),
    ).toBe(true);
  });

  it("does not scroll when user is far from bottom", () => {
    expect(
      shouldAutoScrollToBottom({
        previousActivityCount: 5,
        nextActivityCount: 6,
        distanceFromBottom: 300,
      }),
    ).toBe(false);
  });
});
