"use client";

import { useRef, useCallback } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import { useTranslation, LOCALES, LOCALE_LABELS, type Locale } from "@/i18n";

/** Short script-based labels for the segmented toggle */
const LOCALE_SHORT: Record<Locale, string> = {
  en: "EN",
  "zh-CN": "\u7B80",
  "zh-TW": "\u7E41",
};

interface LanguageSwitcherProps {
  readonly collapsed?: boolean;
}

export function LanguageSwitcher({ collapsed = false }: LanguageSwitcherProps) {
  const { locale, setLocale } = useTranslation();
  const groupRef = useRef<HTMLDivElement>(null);

  /** Arrow-key roving tabindex handler for the radiogroup */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % LOCALES.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (index - 1 + LOCALES.length) % LOCALES.length;
      }

      if (nextIndex !== null) {
        const nextLocale = LOCALES[nextIndex];
        setLocale(nextLocale);
        const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="radio"]',
        );
        buttons?.[nextIndex]?.focus();
      }
    },
    [setLocale],
  );

  /* ── Collapsed: single button showing current script char, tap cycles ── */
  if (collapsed) {
    const nextLocale =
      LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length];

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setLocale(nextLocale)}
            className="text-muted-foreground transition-colors duration-200 hover:text-foreground hover:bg-sidebar-hover"
            aria-label={`Switch to ${LOCALE_LABELS[nextLocale]}`}
          >
            <span
              className="text-xs font-semibold leading-none"
              lang={locale}
            >
              {LOCALE_SHORT[locale]}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <span lang={nextLocale}>{LOCALE_LABELS[nextLocale]}</span>
        </TooltipContent>
      </Tooltip>
    );
  }

  /* ── Expanded: inline segmented toggle with roving tabindex ── */
  return (
    <div
      ref={groupRef}
      className="flex items-center gap-0.5 rounded-md p-0.5"
      role="radiogroup"
      aria-label="Language"
    >
      {LOCALES.map((loc, index) => {
        const isActive = loc === locale;
        return (
          <button
            key={loc}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={LOCALE_LABELS[loc]}
            tabIndex={isActive ? 0 : -1}
            lang={loc}
            onClick={() => setLocale(loc)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "flex-1 rounded-sm px-2.5 py-1 text-xs font-medium transition-[color,background-color] duration-150 ease-out",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isActive
                ? "bg-background text-foreground ring-1 ring-border"
                : "text-muted-foreground-dim hover:text-foreground",
            )}
          >
            {LOCALE_SHORT[loc]}
          </button>
        );
      })}
    </div>
  );
}
