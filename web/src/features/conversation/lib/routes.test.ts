import { describe, expect, it } from "@jest/globals";
import { getConversationPath } from "./routes";

describe("getConversationPath", () => {
  it("builds the canonical conversation route", () => {
    expect(getConversationPath("conversation-1")).toBe("/c/conversation-1");
  });

  it("encodes route-unsafe conversation ids", () => {
    expect(getConversationPath("folder/test id")).toBe("/c/folder%2Ftest%20id");
  });
});
