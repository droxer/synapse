import { describe, expect, it } from "@jest/globals";

import { badgeVariants } from "./badge";

describe("badgeVariants", () => {
  it("keeps the default badge mapped to primary CTA tokens", () => {
    const classes = badgeVariants({ variant: "default" });

    expect(classes).toContain("bg-primary");
    expect(classes).toContain("text-primary-foreground");
  });

  it("uses tinted support tokens for secondary badges", () => {
    const classes = badgeVariants({ variant: "secondary" });

    expect(classes).toContain("bg-secondary");
    expect(classes).toContain("text-secondary-foreground");
    expect(classes).toContain("[a&]:hover:bg-accent");
  });

  it("uses accent hover states for outline and ghost badges", () => {
    expect(badgeVariants({ variant: "outline" })).toContain("[a&]:hover:bg-accent");
    expect(badgeVariants({ variant: "ghost" })).toContain("[a&]:hover:bg-accent");
  });

  it("uses the focus token for link badges instead of the primary fill token", () => {
    const classes = badgeVariants({ variant: "link" });

    expect(classes).toContain("text-focus");
    expect(classes).not.toContain("text-primary ");
  });
});
