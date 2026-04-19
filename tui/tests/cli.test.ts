import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { resolveConfig } from "../src/cli.ts";

test("resolveConfig requires interactive tty", () => {
  assert.throws(
    () =>
      resolveConfig({
        argv: [],
        stdinIsTTY: false,
        stdoutIsTTY: false,
      }),
    /interactive terminal/,
  );
});

test("resolveConfig requires google id and email together", () => {
  assert.throws(
    () =>
      resolveConfig({
        argv: ["--user-email", "user@example.com"],
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    /both user email and user google id/,
  );
});

test("resolveConfig loads tui .env values", () => {
  const baseDir = mkdtempSync(join(tmpdir(), "synapse-tui-env-"));
  writeFileSync(
    join(baseDir, ".env"),
    [
      "SYNAPSE_TUI_API_URL=http://localhost:3000/api",
      "SYNAPSE_TUI_API_KEY=env-api-key",
      "SYNAPSE_TUI_PROXY_SECRET=env-proxy-secret",
      "SYNAPSE_TUI_USER_EMAIL=user@example.com",
      "SYNAPSE_TUI_USER_GOOGLE_ID=google-123",
      "SYNAPSE_TUI_USER_NAME=Env User",
      "",
    ].join("\n"),
    "utf8",
  );

  const config = resolveConfig({
    argv: [],
    env: {},
    baseDir,
    stdinIsTTY: true,
    stdoutIsTTY: true,
  });

  assert.equal(config.apiUrl, "http://localhost:3000/api");
  assert.equal(config.apiKey, "env-api-key");
  assert.equal(config.proxySecret, "env-proxy-secret");
  assert.equal(config.userEmail, "user@example.com");
  assert.equal(config.userGoogleId, "google-123");
  assert.equal(config.userName, "Env User");
});
