import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { authorizeDesktopTokenCredentials } from "./desktop-auth-credentials";
import {
  issueDesktopAuthExchangeToken,
  resetDesktopAuthStoreForTests,
  storeDesktopAuthSession,
} from "./desktop-auth-store";

describe("desktop-token credentials authorization", () => {
  beforeEach(() => {
    resetDesktopAuthStoreForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("authorizes once with a valid exchange token", () => {
    storeDesktopAuthSession("nonce-1", {
      email: "person@example.com",
      name: "Person Example",
      image: "https://example.com/avatar.png",
      googleId: "google-123",
    });
    const token = issueDesktopAuthExchangeToken("nonce-1");

    expect(authorizeDesktopTokenCredentials({ token })).toEqual({
      id: "google-123",
      email: "person@example.com",
      name: "Person Example",
      image: "https://example.com/avatar.png",
      googleId: "google-123",
    });
    expect(authorizeDesktopTokenCredentials({ token })).toBeNull();
  });

  it("rejects missing and unknown exchange tokens", () => {
    expect(authorizeDesktopTokenCredentials(undefined)).toBeNull();
    expect(authorizeDesktopTokenCredentials({ token: "" })).toBeNull();
    expect(authorizeDesktopTokenCredentials({ token: "unknown" })).toBeNull();
  });

  it("rejects expired exchange tokens", () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    storeDesktopAuthSession("nonce-1", {
      email: "person@example.com",
      name: "Person Example",
      image: "https://example.com/avatar.png",
      googleId: "google-123",
    });
    const token = issueDesktopAuthExchangeToken("nonce-1");

    jest.setSystemTime(63_001);

    expect(authorizeDesktopTokenCredentials({ token })).toBeNull();
  });
});
