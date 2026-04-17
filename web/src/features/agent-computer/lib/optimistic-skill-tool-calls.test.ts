import { describe, expect, it } from "@jest/globals";
import { buildOptimisticSkillToolCalls } from "./optimistic-skill-tool-calls";
import type { ToolCallInfo } from "@/shared/types";

describe("buildOptimisticSkillToolCalls", () => {
  it("creates optimistic skill rows for selected skills without backend confirmation", () => {
    const rows = buildOptimisticSkillToolCalls(
      [{ name: "frontend-design", timestamp: 100 }],
      [],
    );

    expect(rows).toEqual([
      {
        id: "optimistic-skill:frontend-design:0",
        toolUseId: "optimistic-skill:frontend-design",
        name: "activate_skill",
        input: { name: "frontend-design" },
        timestamp: 100,
      },
    ]);
  });

  it("omits optimistic rows once matching skill tool calls already exist", () => {
    const confirmedToolCalls: ToolCallInfo[] = [
      {
        id: "tc-1",
        toolUseId: "tool-1",
        name: "activate_skill",
        input: { name: "frontend-design" },
        timestamp: 120,
        success: true,
      },
    ];

    const rows = buildOptimisticSkillToolCalls(
      [{ name: "frontend-design", timestamp: 100 }],
      confirmedToolCalls,
    );

    expect(rows).toEqual([]);
  });
});
