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

jest.mock("@/i18n", () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "welcome.heading": "What can I build for you?",
        "welcome.subtitle": "Describe your task and let the agent handle the rest",
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
  it("renders a centered welcome heading without forcing a single line", () => {
    const html = renderToStaticMarkup(
      <HomeScreen onSubmitTask={jest.fn()} />,
    );

    expect(html).toContain("What can I build for you?");
    expect(html).toContain("Suggested starting points");
    expect(html).toContain("Prototype a feature");
    expect(html).toContain("Improve this screen");
    expect(html).toContain("Plan the build");
    expect(html).toContain("fills the message box");
    expect(html).toContain("min-h-11");
    expect(html).toContain("heading-display");
    expect(html).toContain("text-center");
    expect(html).not.toContain("whitespace-nowrap");
    expect(html).not.toContain("clamp(");
    expect(html).not.toContain("font-size");
  });
});
