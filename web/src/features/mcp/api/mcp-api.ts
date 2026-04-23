import { API_BASE } from "@/shared/constants";
import type { MCPTransport } from "../lib/parse-mcp-config";

export interface MCPServer {
  readonly name: string;
  readonly transport: MCPTransport;
  readonly url: string;
  readonly status: "connected" | "disconnected";
  readonly tool_count: number;
  readonly enabled: boolean;
}

export interface MCPServerCreateParams {
  readonly name: string;
  readonly transport: MCPTransport;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeout?: number;
}

export async function fetchMCPServers(): Promise<readonly MCPServer[]> {
  const res = await fetch(`${API_BASE}/mcp/servers`);
  if (!res.ok) {
    throw new Error(`Failed to fetch MCP servers: ${res.status}`);
  }
  const data = await res.json();
  return data.servers;
}

export async function addMCPServer(
  config: MCPServerCreateParams,
): Promise<MCPServer> {
  const res = await fetch(`${API_BASE}/mcp/servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to add MCP server: ${detail}`);
  }
  return res.json();
}

export async function toggleMCPServer(
  name: string,
  enabled: boolean,
): Promise<{ name: string; enabled: boolean }> {
  const res = await fetch(
    `${API_BASE}/mcp/servers/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to toggle MCP server: ${res.status}`);
  }
  return res.json();
}

export async function removeMCPServer(name: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/mcp/servers/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new Error(`Failed to remove MCP server: ${res.status}`);
  }
}
