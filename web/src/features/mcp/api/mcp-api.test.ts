import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { updateMCPServer } from "./mcp-api";

describe("mcp-api", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("updates an MCP server with a PUT request", async () => {
    const response = {
      name: "docs-renamed",
      transport: "streamablehttp",
      url: "https://docs.example/mcp",
      headers: { Authorization: "Bearer token" },
      timeout: 45,
      status: "connected",
      tool_count: 2,
      enabled: true,
      editable: true,
    };
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    const result = await updateMCPServer("docs server", {
      name: "docs-renamed",
      transport: "streamablehttp",
      url: "https://docs.example/mcp",
      headers: { Authorization: "Bearer token" },
      timeout: 45,
    });

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/mcp/servers/docs%20server",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "docs-renamed",
          transport: "streamablehttp",
          url: "https://docs.example/mcp",
          headers: { Authorization: "Bearer token" },
          timeout: 45,
        }),
      },
    );
  });
});
