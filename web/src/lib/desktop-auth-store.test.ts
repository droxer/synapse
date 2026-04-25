import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  consumeDesktopAuthExchangeToken,
  issueDesktopAuthExchangeToken,
  resetDesktopAuthStoreForTests,
  storeDesktopAuthSession,
} from "./desktop-auth-store";

const user = {
  email: "person@example.com",
  name: "Person Example",
  image: "https://example.com/avatar.png",
  googleId: "google-123",
};

describe("desktop auth store", () => {
  beforeEach(() => {
    resetDesktopAuthStoreForTests();
  });

  it("issues and consumes a single-use exchange token for a stored nonce", () => {
    storeDesktopAuthSession("nonce-1", user, 1_000);

    const token = issueDesktopAuthExchangeToken("nonce-1", 2_000);

    expect(token).toEqual(expect.any(String));
    expect(issueDesktopAuthExchangeToken("nonce-1", 2_000)).toBeNull();
    expect(consumeDesktopAuthExchangeToken(token ?? "", 2_000)).toEqual(user);
    expect(consumeDesktopAuthExchangeToken(token ?? "", 2_000)).toBeNull();
  });

  it("rejects expired nonce and exchange token entries", () => {
    storeDesktopAuthSession("expired-nonce", user, 1_000);
    expect(issueDesktopAuthExchangeToken("expired-nonce", 130_001)).toBeNull();

    storeDesktopAuthSession("fresh-nonce", user, 1_000);
    const token = issueDesktopAuthExchangeToken("fresh-nonce", 2_000);

    expect(token).toEqual(expect.any(String));
    expect(consumeDesktopAuthExchangeToken(token ?? "", 63_001)).toBeNull();
  });
});
