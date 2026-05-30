import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("framer-motion", () => ({
  __esModule: true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <div {...props}>{children}</div>,
    section: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <section {...props}>{children}</section>,
    button: ({
      children,
      whileHover: _whileHover,
      whileTap: _whileTap,
      transition: _transition,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      whileHover?: unknown;
      whileTap?: unknown;
      transition?: unknown;
    }) => <button {...props}>{children}</button>,
  },
}));

jest.mock("./ChatInput", () => ({
  __esModule: true,
  ChatInput: () => <div data-testid="chat-input" />,
}));

jest.mock("@/shared/components/ErrorBanner", () => ({
  __esModule: true,
  ErrorBanner: ({ message }: { message: string }) => <div>{message}</div>,
}));

const zhSubtitle = "描述你的任务，让智能体来完成";

jest.mock("@/i18n", () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "welcome.heading": "我能为你构建什么？",
        "welcome.subtitle": zhSubtitle,
        "welcome.suggestionsLabel": "Suggested starting points",
        "welcome.suggestion.prototype": "Prototype a feature",
        "welcome.suggestion.prototypePrompt": "Prototype a focused feature with polished UI, accessible interactions, edge cases, and tests.",
        "welcome.suggestion.improve": "Improve this screen",
        "welcome.suggestion.improvePrompt": "Improve this screen for accessibility, interaction clarity, responsive layout, and visual polish.",
        "welcome.suggestion.planBuild": "Plan the build",
        "welcome.suggestion.planBuildPrompt": "Plan this build with implementation steps, accessibility checks, tests, and acceptance criteria.",
        "welcome.suggestion.actionHint": "fills the message box",
        "welcome.suggestion.addedStatus": "Prompt added to composer: {label}",
      };
      return translations[key] ?? key;
    },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HomeScreen } = require("./HomeScreen");

describe("HomeScreen", () => {
  it("renders CJK welcome copy with block-centered utilities (not flex items-center)", () => {
    const html = renderToStaticMarkup(
      <HomeScreen onSubmitTask={jest.fn()} />,
    );

    expect(html).toContain("我能为你构建什么？");
    expect(html).toContain(zhSubtitle);
    expect(html).toContain("cjk-safe-centered text-heading-lg");
    expect(html).toContain("cjk-safe-centered-constrained text-body-md");
    expect(html).not.toContain("flex-col items-center");
    expect(html).not.toContain("items-center justify-center px-4");
  });

  it("renders suggestion chips with pill touch targets", () => {
    const html = renderToStaticMarkup(
      <HomeScreen onSubmitTask={jest.fn()} />,
    );

    expect(html).toContain("Prototype a feature");
    expect(html).toContain("min-h-11");
  });
});
