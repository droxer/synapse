import { describe, expect, it } from "@jest/globals";

import { buttonVariants } from "./button";

describe("buttonVariants", () => {
  it("keeps the default variant mapped to primary CTA tokens", () => {
    const classes = buttonVariants({ variant: "default" });

    expect(classes).toContain("bg-primary");
    expect(classes).toContain("text-primary-foreground");
    expect(classes).toContain("hover:bg-primary/90");
  });

  it("uses tinted support tokens for secondary actions", () => {
    const classes = buttonVariants({ variant: "secondary" });

    expect(classes).toContain("bg-secondary");
    expect(classes).toContain("text-secondary-foreground");
    expect(classes).toContain("hover:bg-accent");
  });

  it("uses accent hover states for ghost actions", () => {
    const classes = buttonVariants({ variant: "ghost" });

    expect(classes).toContain("hover:bg-accent");
    expect(classes).toContain("hover:text-accent-foreground");
  });

  it("uses the focus token for inline links instead of the primary fill token", () => {
    const classes = buttonVariants({ variant: "link" });

    expect(classes).toContain("text-focus");
    expect(classes).not.toContain("text-primary ");
  });
});
