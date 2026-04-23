export type MCPTransport = "sse" | "streamablehttp";

export interface ParsedMCPConfig {
  readonly name: string;
  readonly transport: MCPTransport;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeout?: number;
}

const VALID_TRANSPORTS = new Set<MCPTransport>(["sse", "streamablehttp"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonLikeSnippet(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Config JSON is empty");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return JSON.parse(`{${trimmed}}`);
  }
}

function stringRecord(
  value: unknown,
  fieldName: string,
): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`${fieldName}.${key} must be a string`);
    }
    result[key] = item;
  }
  return result;
}

function normalizeConfigEntry(root: unknown): { name: string; entry: Record<string, unknown> } {
  if (!isRecord(root)) {
    throw new Error("Config JSON must be an object");
  }

  const container = isRecord(root.mcpServers) ? root.mcpServers : root;

  if (
    typeof container.name === "string" &&
    (typeof container.transport === "string" ||
      typeof container.type === "string" ||
      typeof container.url === "string")
  ) {
    return { name: container.name, entry: container };
  }

  const entries = Object.entries(container).filter(([, value]) => isRecord(value));
  if (entries.length !== 1) {
    throw new Error("Config JSON must contain exactly one MCP server");
  }

  const [name, entry] = entries[0];
  return { name, entry: entry as Record<string, unknown> };
}

export function parseMCPConfig(value: string): ParsedMCPConfig {
  const root = parseJsonLikeSnippet(value);
  const { name, entry } = normalizeConfigEntry(root);
  const rawTransport = entry.transport ?? entry.type;
  const transport =
    typeof rawTransport === "string" ? rawTransport.trim() : "streamablehttp";

  if (!VALID_TRANSPORTS.has(transport as MCPTransport)) {
    throw new Error("transport must be sse or streamablehttp");
  }

  const url = typeof entry.url === "string" ? entry.url.trim() : "";

  if (!url) {
    throw new Error(`${transport} transport requires a url`);
  }

  const timeout =
    typeof entry.timeout === "number" && Number.isFinite(entry.timeout)
      ? entry.timeout
      : undefined;

  return {
    name: name.trim(),
    transport: transport as MCPTransport,
    url,
    headers: stringRecord(entry.headers, "headers"),
    timeout,
  };
}
