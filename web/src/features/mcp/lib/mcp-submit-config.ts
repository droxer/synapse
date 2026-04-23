import type { MCPServerCreateParams } from "../api/mcp-api";
import { parseMCPConfig } from "./parse-mcp-config";

export function buildMCPServerConfigFromJson(
  schema: string,
): MCPServerCreateParams {
  const parsed = parseMCPConfig(schema);
  return {
    name: parsed.name,
    transport: parsed.transport,
    url: parsed.url,
    headers: parsed.headers,
    timeout: parsed.timeout,
  };
}
