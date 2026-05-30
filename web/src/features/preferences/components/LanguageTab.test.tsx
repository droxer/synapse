import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/shared/hooks/use-user-preferences", () => ({
  useUserPreferences: () => ({ savePreferences: jest.fn() }),
}));

jest.mock("@/i18n", () => ({
  LOCALES: ["en", "zh-CN", "zh-TW"],
  useTranslation: () => ({
    locale: "zh-CN",
    setLocale: jest.fn(),
    t: (key: string) =>
      ({
        "preferences.tabs.language": "Language",
        "preferences.language.title": "Display language",
        "preferences.language.description": "Choose your preferred language",
      })[key] ?? key,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LanguageTab } = require("./LanguageTab");

describe("LanguageTab", () => {
  it("renders locale cards with block layout so CJK labels stay horizontal", () => {
    const html = renderToStaticMarkup(<LanguageTab />);

    expect(html).toContain("简体中文");
    expect(html).toContain("繁體中文");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("grid w-full grid-cols-1 gap-3 sm:grid-cols-3");
    expect(html).toContain("block w-full rounded-xl");
    expect(html).toContain("cjk-safe-centered relative text-heading-md");
    expect(html).not.toContain("flex-1 min-w-0");
    expect(html).not.toContain("minmax(0,1fr)");
  });
});
