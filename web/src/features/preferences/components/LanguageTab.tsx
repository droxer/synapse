"use client";

import { Check } from "lucide-react";
import { useTranslation, LOCALES, type Locale } from "@/i18n";
import { useUserPreferences } from "@/shared/hooks/use-user-preferences";
import { cn } from "@/shared/lib/utils";

const LOCALE_LABELS: Record<Locale, { readonly name: string; readonly native: string }> = {
  en: { name: "English", native: "English" },
  "zh-CN": { name: "Simplified Chinese", native: "简体中文" },
  "zh-TW": { name: "Traditional Chinese", native: "繁體中文" },
};

export function LanguageTab() {
  const { t, locale, setLocale } = useTranslation();
  const { savePreferences } = useUserPreferences();

  const handleSelect = (loc: Locale) => {
    setLocale(loc);
    savePreferences({ locale: loc });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {t("preferences.language.title")}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("preferences.language.description")}
        </p>
      </div>

      <div className="space-y-2 max-w-xl">
        {LOCALES.map((loc) => {
          const isActive = loc === locale;
          const label = LOCALE_LABELS[loc];
          return (
            <button
              key={loc}
              type="button"
              onClick={() => handleSelect(loc)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-[color,background-color,border-color] duration-150 ease-out",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                "hover:border-border-strong",
                isActive
                  ? "border-border-strong bg-muted"
                  : "border-border bg-card",
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {label.native}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {label.name}
                </p>
              </div>
              {isActive && (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                  <Check className="h-3 w-3 text-foreground" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
