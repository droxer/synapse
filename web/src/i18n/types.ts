export type Locale = "en" | "zh-CN" | "zh-TW";

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALES: readonly Locale[] = ["en", "zh-CN", "zh-TW"] as const;

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
};

export const COOKIE_NAME = "synapse-locale";

export type TranslationParams = Record<string, string | number>;

export type TranslationDict = Record<string, string | string[]>;
