import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DEFAULT_TUI_CONFIG } from "./types.ts";
import type { TuiConfig } from "./types.ts";

interface ResolveConfigOptions {
  readonly argv?: string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly stdinIsTTY?: boolean;
  readonly stdoutIsTTY?: boolean;
  readonly baseDir?: string;
}

export function resolveConfig(
  options: ResolveConfigOptions = {},
): TuiConfig {
  const argv = options.argv ?? process.argv.slice(2);
  const baseDir = options.baseDir ?? getDefaultBaseDir();
  const env = {
    ...loadDotEnvFiles(baseDir),
    ...(options.env ?? process.env),
  };

  const parsed = parseArgs({
    args: argv,
    options: {
      "api-url": { type: "string" },
      "api-key": { type: "string" },
      "proxy-secret": { type: "string" },
      cookie: { type: "string" },
      "user-google-id": { type: "string" },
      "user-email": { type: "string" },
      "user-name": { type: "string" },
      "user-picture": { type: "string" },
      "conversation-id": { type: "string" },
      planner: { type: "boolean", default: false },
      "no-planner": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (parsed.values.planner && parsed.values["no-planner"]) {
    throw new Error("Use only one of --planner or --no-planner.");
  }

  const stdinIsTTY = options.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const stdoutIsTTY = options.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  if (!stdinIsTTY || !stdoutIsTTY) {
    throw new Error(
      "Synapse TUI requires an interactive terminal (TTY). Run `make tui` from a real terminal window.",
    );
  }

  const userGoogleId =
    parsed.values["user-google-id"] ?? env.SYNAPSE_TUI_USER_GOOGLE_ID ?? null;
  const userEmail =
    parsed.values["user-email"] ?? env.SYNAPSE_TUI_USER_EMAIL ?? null;

  if ((userGoogleId && !userEmail) || (userEmail && !userGoogleId)) {
    throw new Error(
      "Direct backend user auth requires both user email and user google id. "
      + "Set both SYNAPSE_TUI_USER_EMAIL and SYNAPSE_TUI_USER_GOOGLE_ID "
      + "(or the matching CLI flags).",
    );
  }

  return {
    ...DEFAULT_TUI_CONFIG,
    apiUrl:
      parsed.values["api-url"]
      ?? env.SYNAPSE_TUI_API_URL
      ?? DEFAULT_TUI_CONFIG.apiUrl,
    apiKey: parsed.values["api-key"] ?? env.SYNAPSE_TUI_API_KEY ?? null,
    proxySecret:
      parsed.values["proxy-secret"] ?? env.SYNAPSE_TUI_PROXY_SECRET ?? null,
    cookie: parsed.values.cookie ?? env.SYNAPSE_TUI_COOKIE ?? null,
    userGoogleId,
    userEmail,
    userName: parsed.values["user-name"] ?? env.SYNAPSE_TUI_USER_NAME ?? null,
    userPicture:
      parsed.values["user-picture"] ?? env.SYNAPSE_TUI_USER_PICTURE ?? null,
    conversationId:
      parsed.values["conversation-id"] ?? env.SYNAPSE_TUI_CONVERSATION_ID ?? null,
    usePlanner: parsed.values.planner
      ? true
      : parsed.values["no-planner"]
        ? false
        : null,
  };
}

function getDefaultBaseDir(): string {
  return fileURLToPath(new URL("..", import.meta.url));
}

function loadDotEnvFiles(baseDir: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const fileName of [".env", ".env.local"]) {
    const filePath = `${baseDir}/${fileName}`;
    if (!existsSync(filePath)) {
      continue;
    }
    Object.assign(merged, parseDotEnv(readFileSync(filePath, "utf8")));
  }
  return merged;
}

function parseDotEnv(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = rawLine.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
    );
    if (!match) {
      continue;
    }

    const key = match[1];
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }

    result[key] = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
  return result;
}
