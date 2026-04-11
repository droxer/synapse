import { describe, expect, it } from "@jest/globals";
import { getConversationIdFromPathname } from "./use-conversation-route-sync";

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
