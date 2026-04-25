import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("framer-motion", () => ({
  __esModule: true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
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
    expect(html).toContain("heading-display");
    expect(html).toContain("text-center");
    expect(html).not.toContain("whitespace-nowrap");
    expect(html).not.toContain("clamp(");
    expect(html).not.toContain("font-size");
  });
});
