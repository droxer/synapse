import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

function loadBackendEnvFallback(): void {
  const backendEnvPath = path.resolve(process.cwd(), "../backend/.env");
  if (!fs.existsSync(backendEnvPath)) {
    return;
  }

  const parsed: Record<string, string> = {};
  const lines = fs.readFileSync(backendEnvPath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const inlineCommentIndex = value.search(/\s+#/);
      if (inlineCommentIndex >= 0) {
        value = value.slice(0, inlineCommentIndex).trim();
      }
    }

    parsed[key] = value;
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadBackendEnvFallback();

const nextConfig: NextConfig = {
  // Rewrites removed — backend proxy is now handled by
  // src/app/api/[...proxy]/route.ts which injects auth headers.
};

export default nextConfig;
