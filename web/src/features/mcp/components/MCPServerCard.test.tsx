import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { MCPServer } from "../api/mcp-api";

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        "mcp.toolCount": `${params?.count ?? 0} tool`,
        "mcp.toolsCount": `${params?.count ?? 0} tools`,
        "mcp.connected": "Connected",
        "mcp.disconnected": "Disconnected",
        "mcp.enable": "Enable",
        "mcp.disable": "Disable",
        "mcp.enabled": "Enabled",
        "mcp.disabled": "Disabled",
        "mcp.remove": "Remove",
      };
      return dict[key] ?? key;
    },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MCPServerCard } = require("./MCPServerCard");

function serverFixture(overrides: Partial<MCPServer> = {}): MCPServer {
  return {
    name: "browser",
    transport: "streamablehttp",
    url: "http://localhost:3000/mcp",
    status: "connected",
    tool_count: 3,
    enabled: true,
    ...overrides,
  };
}

describe("MCPServerCard style contract", () => {
  it("uses shared status chip classes for transport and enabled state", () => {
    const html = renderToStaticMarkup(
      <MCPServerCard
        server={serverFixture()}
        onDelete={() => undefined}
        onToggle={() => undefined}
      />,
    );

    expect(html).toContain("status-pill");
    expect(html).toContain("chip-xs");
    expect(html).toContain("status-neutral");
    expect(html).toContain("aria-label=\"Disable browser\"");
  });
});
