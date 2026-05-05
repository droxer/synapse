"use client";

import { useState, useEffect } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { SegmentedControl } from "@/shared/components/SegmentedControl";
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
      : "bg-muted";

  const barColor = variant === "dark"
    ? "bg-muted-foreground"
    : variant === "light"
      ? "bg-border-strong"
      : "bg-border-active";

  const dotColor = variant === "dark"
    ? "bg-muted-foreground-dim"
    : variant === "light"
      ? "bg-border"
      : "bg-muted-foreground-dim";

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
  const selectedOption = THEME_OPTIONS.find((option) => option.value === currentTheme) ?? THEME_OPTIONS[2];
  const SelectedIcon = selectedOption.icon;

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

      <SegmentedControl<ThemeValue>
        ariaLabel={t("preferences.theme.title")}
        value={currentTheme}
        onValueChange={handleSelect}
        className="w-full"
        optionClassName="flex-1"
        options={THEME_OPTIONS.map(({ value, icon: Icon, labelKey }) => ({
          value,
          label: t(labelKey),
          icon: <Icon className="h-3.5 w-3.5" />,
        }))}
      />

      <div className="surface-panel p-3">
        <ThemePreview variant={currentTheme} />
        <div className="mt-3 flex items-center gap-1.5">
          <SelectedIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            {t(selectedOption.labelKey)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(selectedOption.descKey)}
        </p>
      </div>
    </div>
  );
}
