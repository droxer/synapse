import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { HTMLAttributes, ReactNode } from "react";
import type { PlanStep } from "@/shared/types";

interface MockDivProps extends HTMLAttributes<HTMLDivElement> {
  readonly children?: ReactNode;
}

interface MockLiProps extends HTMLAttributes<HTMLLIElement> {
  readonly children?: ReactNode;
}

interface MockNodeProps {
  readonly children?: ReactNode;
}

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: MockDivProps) => <div {...props}>{children}</div>,
    li: ({ children, ...props }: MockLiProps) => <li {...props}>{children}</li>,
  },
  AnimatePresence: ({ children }: MockNodeProps) => <>{children}</>,
}));

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        "plan.title": "Plan",
        "plan.progress": `${params?.completed ?? 0}/${params?.total ?? 0} complete`,
      };
      return dict[key] ?? key;
    },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PlanChecklistPanel } = require("./PlanChecklistPanel");

describe("PlanChecklistPanel", () => {
  it("renders skipped and replan-required states with resolved-count progress semantics", () => {
    const planSteps: PlanStep[] = [
      {
        name: "Completed step",
        description: "Done already",
        executionType: "planner_owned",
        status: "complete",
      },
      {
        name: "Skipped step",
        description: "Optional branch",
        executionType: "parallel_worker",
        status: "skipped",
      },
      {
        name: "Replan step",
        description: "Blocked branch",
        executionType: "parallel_worker",
        status: "replan_required",
      },
      {
        name: "Failed step",
        description: "Hard error",
        executionType: "parallel_worker",
        status: "error",
      },
    ];

    const html = renderToStaticMarkup(<PlanChecklistPanel planSteps={planSteps} />);

    expect(html).toContain("2/4 complete");
    expect(html).toContain("Skipped step");
    expect(html).toContain("Replan step");
    expect(html).toContain("opacity-70");
    expect(html).toContain("text-accent-amber");
    expect(html).toContain("status-warn");
  });
});
