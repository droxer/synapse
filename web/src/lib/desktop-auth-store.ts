import { randomBytes } from "node:crypto";

export interface DesktopAuthUser {
  readonly email: string;
  readonly name: string;
  readonly image: string;
  readonly googleId: string;
}

interface DesktopAuthEntry {
  readonly user: DesktopAuthUser;
  readonly expiresAt: number;
}

const NONCE_TTL_MS = 120_000;
const EXCHANGE_TOKEN_TTL_MS = 60_000;

const pendingSessions = new Map<string, DesktopAuthEntry>();
const exchangeTokens = new Map<string, DesktopAuthEntry>();

function cleanupExpiredDesktopAuthEntries(now = Date.now()) {
  for (const [key, value] of pendingSessions) {
    if (value.expiresAt < now) {
      pendingSessions.delete(key);
    }
  }

  for (const [key, value] of exchangeTokens) {
    if (value.expiresAt < now) {
      exchangeTokens.delete(key);
    }
  }
}

const cleanupTimer = setInterval(cleanupExpiredDesktopAuthEntries, 10_000);
if (
  typeof cleanupTimer === "object" &&
  cleanupTimer !== null &&
  "unref" in cleanupTimer &&
  typeof cleanupTimer.unref === "function"
) {
  cleanupTimer.unref();
}

function createExchangeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function storeDesktopAuthSession(
  nonce: string,
  user: DesktopAuthUser,
  now = Date.now(),
): void {
  pendingSessions.set(nonce, {
    user,
    expiresAt: now + NONCE_TTL_MS,
  });
}

export function issueDesktopAuthExchangeToken(
  nonce: string,
  now = Date.now(),
): string | null {
  const entry = pendingSessions.get(nonce);
  if (!entry || entry.expiresAt < now) {
    pendingSessions.delete(nonce);
    return null;
  }

  pendingSessions.delete(nonce);
  const token = createExchangeToken();
  exchangeTokens.set(token, {
    user: entry.user,
    expiresAt: now + EXCHANGE_TOKEN_TTL_MS,
  });
  return token;
}

export function consumeDesktopAuthExchangeToken(
  token: string,
  now = Date.now(),
): DesktopAuthUser | null {
  const entry = exchangeTokens.get(token);
  if (!entry || entry.expiresAt < now) {
    exchangeTokens.delete(token);
    return null;
  }

  exchangeTokens.delete(token);
  return entry.user;
}

export function resetDesktopAuthStoreForTests(): void {
  pendingSessions.clear();
  exchangeTokens.clear();
}
