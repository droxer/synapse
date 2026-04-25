import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  consumeDesktopAuthExchangeToken,
  type DesktopAuthUser,
  resetDesktopAuthStoreForTests,
} from "@/lib/desktop-auth-store";
import { setDesktopAuthUserResolverForTests } from "@/lib/desktop-auth-session";

const mockAuth = jest.fn<() => Promise<DesktopAuthUser | null>>();

import { GET, POST } from "./route";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/auth/desktop-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(nonce: string) {
  return new Request(
    `http://localhost/api/auth/desktop-token?nonce=${encodeURIComponent(nonce)}`,
  );
}

describe("/api/auth/desktop-token", () => {
  beforeEach(() => {
    resetDesktopAuthStoreForTests();
    mockAuth.mockReset();
    setDesktopAuthUserResolverForTests(() => mockAuth());
  });

  afterEach(() => {
    setDesktopAuthUserResolverForTests(null);
  });

  it("stores an authenticated browser session under a nonce", async () => {
    mockAuth.mockResolvedValue({
      email: "person@example.com",
      name: "Person Example",
      image: "https://example.com/avatar.png",
      googleId: "google-123",
    });

    const postResponse = await POST(postRequest({ nonce: "nonce-1" }));
    expect(postResponse.status).toBe(200);

    const getResponse = await GET(getRequest("nonce-1"));
    expect(getResponse.status).toBe(200);

    const body = await getResponse.json();
    expect(body).toEqual({
      status: "complete",
      token: expect.any(String),
    });
    expect(body).not.toHaveProperty("user");
    expect(consumeDesktopAuthExchangeToken(body.token)).toEqual({
      email: "person@example.com",
      name: "Person Example",
      image: "https://example.com/avatar.png",
      googleId: "google-123",
    });
  });

  it("rejects unauthenticated POST requests", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST(postRequest({ nonce: "nonce-1" }));

    expect(response.status).toBe(401);
  });

  it("consumes a nonce only once", async () => {
    mockAuth.mockResolvedValue({
      email: "person@example.com",
      name: "",
      image: "",
      googleId: "user-1",
    });

    await POST(postRequest({ nonce: "nonce-1" }));

    expect((await GET(getRequest("nonce-1"))).status).toBe(200);
    expect((await GET(getRequest("nonce-1"))).status).toBe(404);
  });
});
