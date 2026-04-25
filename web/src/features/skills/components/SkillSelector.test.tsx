import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/shared/components/ui/popover", () => ({
  __esModule: true,
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

jest.mock("@/i18n", () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const translations: Record<string, string> = {
        "skills.selector.select": "Select skill",
        "skills.selector.remove": `Remove ${params?.name ?? "skill"}`,
        "skills.selector.noSkills": "No skills",
        "skills.selector.noMatching": "No matching skills",
        "chat.skillLabel": "Skill",
      };
      return translations[key] ?? key;
    },
  }),
}));

jest.mock("../hooks/use-skills-cache", () => ({
  __esModule: true,
  useSkillsCache: () => ({
    getAllSkills: () => [
      { name: "web-research", description: "Research the web", enabled: true },
    ],
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SkillSelector } = require("./SkillSelector");

describe("SkillSelector", () => {
  it("keeps an accessible name on the selected compact trigger", () => {
    const html = renderToStaticMarkup(
      <SkillSelector selectedSkill="web-research" onSelect={jest.fn()} />,
    );

    expect(html).toContain('aria-label="Select skill: Web Research"');
    expect(html).toContain("hidden sm:inline");
  });
});
