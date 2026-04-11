import { describe, expect, it } from "@jest/globals";
import { getSidebarTaskIndicatorVariant } from "./sidebar-task-indicator";

describe("getSidebarTaskIndicatorVariant", () => {
  it("prioritizes running state over active state", () => {
    expect(
      getSidebarTaskIndicatorVariant({
        isRunning: true,
        isActive: true,
      }),
    ).toBe("running");
  });

  it("returns active when task is selected and not running", () => {
    expect(
      getSidebarTaskIndicatorVariant({
        isRunning: false,
        isActive: true,
      }),
    ).toBe("active");
  });

  it("returns idle when task is neither active nor running", () => {
    expect(
      getSidebarTaskIndicatorVariant({
        isRunning: false,
        isActive: false,
      }),
    ).toBe("idle");
  });
});
