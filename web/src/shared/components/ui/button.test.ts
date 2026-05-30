import { describe, expect, it } from "@jest/globals";

import { buttonVariants } from "./button";

/**
 * DESIGN.md button system contract:
 * - `default` is the commerce primary (cobalt fill, white text).
 * - `marketing` is the marketing primary (black pill, white text).
 * - `secondary` is the outlined ghost with a 2px ink-deep border. `outline` is removed.
 * - `ghost` is a soft 1px hairline-soft tertiary affordance.
 * - Every variant is pill-shaped (`rounded-full`).
 */
describe("buttonVariants", () => {
  it("default variant uses the cobalt commerce primary", () => {
    const classes = buttonVariants({ variant: "default" });
    expect(classes).toContain("bg-cobalt");
    expect(classes).toContain("text-on-cobalt");
    expect(classes).toContain("hover:bg-cobalt-deep");
  });

  it("marketing variant uses the black ink-button primary", () => {
    const classes = buttonVariants({ variant: "marketing" });
    expect(classes).toContain("bg-ink-button");
    expect(classes).toContain("text-on-ink-button");
  });

  it("secondary renders a 2px ink-deep outlined pill", () => {
    const classes = buttonVariants({ variant: "secondary" });
    expect(classes).toContain("border-2");
    expect(classes).toContain("border-ink-deep");
    expect(classes).toContain("text-ink-deep");
  });

  it("ghost uses a 1px hairline-soft outline", () => {
    const classes = buttonVariants({ variant: "ghost" });
    expect(classes).toContain("border-hairline-soft");
    expect(classes).not.toContain("border-2");
  });

  it("link buttons use cobalt text and no solid fill", () => {
    const classes = buttonVariants({ variant: "link" });
    expect(classes).toContain("text-cobalt");
    expect(classes).not.toMatch(/\bbg-cobalt\b/);
  });

  it("every interactive variant is pill-shaped (rounded-full)", () => {
    for (const variant of [
      "default", "marketing", "secondary", "ghost", "destructive",
      "pill-tab", "pill-tab-active",
    ] as const) {
      expect(buttonVariants({ variant })).toContain("rounded-full");
    }
  });
});
