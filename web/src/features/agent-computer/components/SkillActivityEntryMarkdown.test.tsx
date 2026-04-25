import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { HTMLAttributes, ReactNode } from "react";
import type { ToolCallInfo } from "@/shared/types";

interface MockDivProps extends HTMLAttributes<HTMLDivElement> {
  readonly children?: ReactNode;
}

interface MockSpanProps extends HTMLAttributes<HTMLSpanElement> {
  readonly children?: ReactNode;
}

interface MockNodeProps {
  readonly children?: ReactNode;
}

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: MockDivProps) => <div {...props}>{children}</div>,
    p: ({ children, ...props }: MockDivProps) => <p {...props}>{children}</p>,
    span: ({ children, ...props }: MockSpanProps) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: MockNodeProps) => <>{children}</>,
}));

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "skills.activity.skillFailed": "Skill failed",
        "skills.activity.failed": "Failed",
        "skills.activity.showError": "Show error",
        "skills.activity.hideError": "Hide error",
      };
      return dict[key] ?? key;
    },
  }),
}));

jest.mock("@/features/skills/hooks/use-skills-cache", () => ({
  useSkillsCache: () => ({
    getSkill: () => null,
    isLoading: false,
  }),
}));

jest.mock("@/shared/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content, className }: { readonly content: string; readonly className?: string }) => (
    <div data-markdown="true" className={className}>{content}</div>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SkillActivityEntry } = require("./SkillActivityEntry");

describe("SkillActivityEntry markdown", () => {
  it("renders skill failure output through markdown", () => {
    const toolCall: ToolCallInfo = {
      id: "skill-1",
      toolUseId: "skill-1",
      name: "activate_skill",
      input: { name: "frontend-design" },
      timestamp: 1,
      success: false,
      output: "**Install failed**\n\n- Missing package",
    };

    const html = renderToStaticMarkup(<SkillActivityEntry toolCall={toolCall} />);

    expect(html).toContain("data-markdown=\"true\"");
    expect(html).toContain("**Install failed**");
    expect(html).toContain("[&amp;_ul]:my-1.5");
  });
});
