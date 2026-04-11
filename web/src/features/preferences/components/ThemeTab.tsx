"use client";

import { useState, useEffect } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { useTheme } from "next-themes";
import { useUserPreferences } from "@/shared/hooks/use-user-preferences";
import { useTranslation } from "@/i18n";
import { cn } from "@/shared/lib/utils";

type ThemeValue = "light" | "dark" | "system";

const THEME_OPTIONS: readonly {
  readonly value: ThemeValue;
  readonly icon: typeof Sun;
  readonly labelKey: string;
  readonly descKey: string;
}[] = [
  { value: "light", icon: Sun, labelKey: "theme.light", descKey: "preferences.theme.lightDesc" },
  { value: "dark", icon: Moon, labelKey: "theme.dark", descKey: "preferences.theme.darkDesc" },
  { value: "system", icon: Monitor, labelKey: "theme.system", descKey: "preferences.theme.systemDesc" },
];

function ThemePreview({ variant }: { readonly variant: ThemeValue }) {
  const bg = variant === "dark"
    ? "bg-secondary"
    : variant === "light"
      ? "bg-background"
      : "bg-gradient-to-r from-background to-secondary";

  const barColor = variant === "dark"
    ? "bg-muted-foreground"
    : variant === "light"
      ? "bg-border-strong"
      : "bg-gradient-to-r from-border-strong to-muted-foreground";

  const dotColor = variant === "dark"
    ? "bg-muted-foreground-dim"
    : variant === "light"
      ? "bg-border"
      : "bg-gradient-to-r from-border to-muted-foreground-dim";

  return (
    <div className={cn("h-20 w-full rounded-md border border-border overflow-hidden", bg)}>
      <div className="flex h-full flex-col justify-between p-2.5">
        <div className="flex items-center gap-1.5">
          <div className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
          <div className={cn("h-1.5 w-8 rounded-full", barColor)} />
        </div>
        <div className="space-y-1.5">
          <div className={cn("h-1.5 w-full rounded-full", barColor)} />
          <div className={cn("h-1.5 w-3/4 rounded-full", barColor)} />
          <div className={cn("h-1.5 w-1/2 rounded-full", barColor)} />
        </div>
      </div>
    </div>
  );
}

export function ThemeTab() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { savePreferences } = useUserPreferences();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = mounted ? (theme as ThemeValue) ?? "dark" : "dark";

  const handleSelect = (value: ThemeValue) => {
    setTheme(value);
    savePreferences({ theme: value });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {t("preferences.theme.title")}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("preferences.theme.description")}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {THEME_OPTIONS.map(({ value, icon: Icon, labelKey, descKey }) => {
          const isActive = currentTheme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => handleSelect(value)}
              className={cn(
                "relative flex flex-col items-start rounded-lg border-2 p-3 text-left transition-[color,background-color,border-color] duration-150 ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "hover:border-border-strong",
                isActive
                  ? "border-border-strong bg-muted/60"
                  : "border-border bg-card",
              )}
            >
              {isActive && (
                <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background">
                  <Check className="h-3 w-3 text-foreground" />
                </div>
              )}
              <ThemePreview variant={value} />
              <div className="mt-3 flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  {t(labelKey)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(descKey)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
