import { describe, expect, it } from "@jest/globals";

import { buildMCPServerConfigFromJson } from "./mcp-submit-config";

describe("buildMCPServerConfigFromJson", () => {
  it("builds the submit payload directly from the current JSON", () => {
    const config = buildMCPServerConfigFromJson(JSON.stringify({
      "fresh-docs": {
        type: "streamablehttp",
        url: "https://fresh.example/mcp",
        headers: { Authorization: "Bearer fresh" },
        timeout: 45,
      },
    }));

    expect(config).toEqual({
      name: "fresh-docs",
      transport: "streamablehttp",
      url: "https://fresh.example/mcp",
      headers: { Authorization: "Bearer fresh" },
      timeout: 45,
    });
  });
});
