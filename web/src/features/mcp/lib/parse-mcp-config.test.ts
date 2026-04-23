import { describe, expect, it } from "@jest/globals";

import { parseMCPConfig } from "./parse-mcp-config";

describe("parseMCPConfig", () => {
  it("parses a loose top-level server snippet", () => {
    const parsed = parseMCPConfig(`"mcd-mcp": {
      "type": "streamablehttp",
      "url": "https://mcp.mcd.cn",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }`);

    expect(parsed).toEqual({
      name: "mcd-mcp",
      transport: "streamablehttp",
      url: "https://mcp.mcd.cn",
      headers: {
        Authorization: "Bearer YOUR_MCP_TOKEN",
      },
      timeout: undefined,
    });
  });

  it("parses an mcpServers object", () => {
    const parsed = parseMCPConfig(JSON.stringify({
      mcpServers: {
        docs: {
          type: "streamablehttp",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token" },
        },
      },
    }));

    expect(parsed.name).toBe("docs");
    expect(parsed.transport).toBe("streamablehttp");
    expect(parsed.url).toBe("https://example.com/mcp");
    expect(parsed.headers.Authorization).toBe("Bearer token");
  });

  it("parses a named direct object", () => {
    const parsed = parseMCPConfig(JSON.stringify({
      name: "remote-docs",
      transport: "sse",
      url: "https://example.com/sse",
      timeout: 15,
    }));

    expect(parsed.name).toBe("remote-docs");
    expect(parsed.transport).toBe("sse");
    expect(parsed.url).toBe("https://example.com/sse");
    expect(parsed.timeout).toBe(15);
  });

  it("rejects stdio configs", () => {
    expect(() => parseMCPConfig(JSON.stringify({
      name: "local-docs",
      transport: "stdio",
      command: "npx",
    }))).toThrow("transport must be sse or streamablehttp");
  });

  it("rejects multiple server entries", () => {
    expect(() => parseMCPConfig(JSON.stringify({
      one: { type: "streamablehttp", url: "https://one.example/mcp" },
      two: { type: "streamablehttp", url: "https://two.example/mcp" },
    }))).toThrow("exactly one MCP server");
  });
});
