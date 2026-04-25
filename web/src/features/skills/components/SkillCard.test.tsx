import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import type { Skill } from "../api/skills-api";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { readonly children?: ReactNode; readonly href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "skills.source.user": "User",
        "skills.enable": "Enable skill",
        "skills.disable": "Disable skill",
        "skills.enabled": "Enabled",
        "skills.disabled": "Disabled",
        "skills.uninstall": "Uninstall",
      };
      return dict[key] ?? key;
    },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SkillCard } = require("./SkillCard");

function skillFixture(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "frontend-design",
    description: "Design frontend surfaces.",
    source_path: "/skills/frontend-design",
    source_type: "user",
    enabled: true,
    ...overrides,
  };
}

describe("SkillCard style contract", () => {
  it("uses shared status chip classes for the enable toggle and keeps sub-actions visible", () => {
    const html = renderToStaticMarkup(
      <SkillCard
        skill={skillFixture()}
        onDelete={() => undefined}
        onToggle={() => undefined}
      />,
    );

    expect(html).toContain("status-pill");
    expect(html).toContain("chip-xs");
    expect(html).toContain("status-neutral");
    expect(html).toContain("aria-label=\"Disable skill Frontend Design\"");
    expect(html).not.toContain("fine-hover-action");
  });
});
