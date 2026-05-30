import { describe, expect, it } from "@jest/globals";

import { badgeVariants } from "./badge";

/**
 * DESIGN.md badge variants resolve to canonical short-name color utilities
 * (`bg-success`, `text-ink-deep`, …) generated from the @theme tokens.
 */
describe("badgeVariants", () => {
  it("default and success share the green success fill", () => {
    for (const variant of ["default", "success"] as const) {
      const classes = badgeVariants({ variant });
      expect(classes).toContain("bg-success");
      expect(classes).toContain("text-canvas");
    }
  });

  it("promo-yellow uses warning yellow on ink-deep text", () => {
    const classes = badgeVariants({ variant: "promo-yellow" });
    expect(classes).toContain("bg-warning");
    expect(classes).toContain("text-ink-deep");
  });

  it("critical and destructive surface the red error tokens", () => {
    expect(badgeVariants({ variant: "critical" })).toContain("bg-critical");
    expect(badgeVariants({ variant: "destructive" })).toContain("bg-critical-strong");
  });

  it("link badges use cobalt text and no solid fill", () => {
    const classes = badgeVariants({ variant: "link" });
    expect(classes).toContain("text-cobalt");
    expect(classes).not.toMatch(/\bbg-cobalt\b/);
  });

  it("every badge is pill-shaped (rounded-full) per DESIGN.md", () => {
    for (const variant of [
      "default", "success", "promo-yellow", "attention", "critical", "destructive",
      "secondary", "outline", "ghost", "link",
    ] as const) {
      expect(badgeVariants({ variant })).toContain("rounded-full");
    }
  });
});
