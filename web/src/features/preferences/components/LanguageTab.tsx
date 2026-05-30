"use client";

import { Check } from "lucide-react";
import { useTranslation, LOCALES, type Locale } from "@/i18n";
import { useUserPreferences } from "@/shared/hooks/use-user-preferences";
import { cn } from "@/shared/lib/utils";
import { TabHeader } from "./TabHeader";

const LOCALE_META: Record<
  Locale,
  {
    readonly native: string;
    readonly name: string;
    readonly script: string;
    readonly preview: string;
  }
> = {
  en: {
    native: "English",
    name: "English",
    script: "Aa",
    preview: "What can I build for you?",
  },
  "zh-CN": {
    native: "简体中文",
    name: "Simplified Chinese",
    script: "简",
    preview: "我能为你构建什么？",
  },
  "zh-TW": {
    native: "繁體中文",
    name: "Traditional Chinese",
    script: "繁",
    preview: "我能為你建構什麼？",
  },
};

export function LanguageTab() {
  const { t, locale, setLocale } = useTranslation();
  const { savePreferences } = useUserPreferences();
  const activeMeta = LOCALE_META[locale];

  const handleSelect = (loc: Locale) => {
    setLocale(loc);
    savePreferences({ locale: loc });
  };

  return (
    <div>
      <TabHeader
        eyebrow={t("preferences.tabs.language")}
        title={t("preferences.language.title")}
        description={t("preferences.language.description")}
        titleId="language-title"
      />

      <div
        role="radiogroup"
        aria-labelledby="language-title"
        className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {LOCALES.map((loc) => {
          const isActive = loc === locale;
          const meta = LOCALE_META[loc];

          return (
            <button
              key={loc}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => handleSelect(loc)}
              className={cn(
                /* Block card — no flex-1/min-w-0 or minmax(0,1fr) on CJK labels. */
                "group relative block w-full rounded-xl border p-5 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                "hover:-translate-y-0.5 hover:border-hairline hover:shadow-sm",
                isActive
                  ? "border-cobalt/35 bg-cobalt/5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-cobalt)_18%,transparent)]"
                  : "border-hairline-soft bg-canvas",
              )}
            >
              {isActive ? (
                <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-cobalt text-on-cobalt">
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
              ) : null}

              <span
                aria-hidden="true"
                className={cn(
                  "block text-heading-md transition-colors duration-200",
                  isActive
                    ? "text-cobalt/70"
                    : "text-hairline group-hover:text-stone",
                )}
              >
                {meta.script}
              </span>

              <span className="mt-4 block text-body-sm-bold text-ink-deep">
                {meta.native}
              </span>
              <span className="mt-1 block text-caption-bold text-steel">
                {meta.name}
              </span>
            </button>
          );
        })}
      </div>

      <section
        aria-live="polite"
        className="surface-panel mt-8 overflow-hidden"
      >
        <div className="border-b border-hairline-soft bg-surface-soft px-4 py-2.5">
          <p className="label-mono text-stone">{t("preferences.language.preview")}</p>
        </div>
        <div className="relative px-5 py-6 sm:px-6 sm:py-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,color-mix(in_srgb,var(--color-cobalt)_8%,transparent),transparent)]"
          />
          <p className="cjk-safe-centered relative text-heading-md text-ink-deep">
            {activeMeta.preview}
          </p>
          <p className="cjk-safe-centered relative mt-3 text-caption-bold text-steel">
            {activeMeta.native}
            <span aria-hidden="true"> · </span>
            Synapse
          </p>
        </div>
      </section>
    </div>
  );
}
