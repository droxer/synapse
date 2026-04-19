import { describe, expect, it } from "@jest/globals";
import { GET } from "./route";

describe("GET /api/desktop/health", () => {
  it("returns the Synapse frontend identity payload", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "healthy",
      service: "synapse-web",
    });
  });
});
