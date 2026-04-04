"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useTranslation } from "@/i18n";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

type ThemeValue = "light" | "dark" | "system";

const THEME_OPTIONS = [
  { value: "light" as const, icon: Sun, labelKey: "theme.light" },
  { value: "dark" as const, icon: Moon, labelKey: "theme.dark" },
  { value: "system" as const, icon: Monitor, labelKey: "theme.system" },
] as const;

const TRIGGER_ICON: Partial<Record<ThemeValue, typeof Moon>> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};

interface ThemeToggleProps {
  readonly collapsed?: boolean;
}

export function ThemeToggle({ collapsed = false }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const prevThemeRef = useRef<string | undefined>(undefined);
  const [spinClass, setSpinClass] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  /* Trigger a one-shot spin animation when theme changes */
  useEffect(() => {
    if (!mounted) return;
    if (prevThemeRef.current !== undefined && prevThemeRef.current !== theme) {
      setSpinClass("animate-[themeSpin_200ms_ease-out]");
      const timer = setTimeout(() => setSpinClass(""), 200);
      return () => clearTimeout(timer);
    }
    prevThemeRef.current = theme;
  }, [theme, mounted]);

  if (!mounted) {
    return <div className={collapsed ? "h-8 w-8" : "h-8"} />;
  }

  const current = (theme ?? "dark") as ThemeValue;
  const Icon = TRIGGER_ICON[current] ?? Moon;
  const currentOption = THEME_OPTIONS.find((o) => o.value === current);
  const currentLabel = currentOption
    ? t(currentOption.labelKey)
    : t("theme.toggle");

  const trigger = collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("theme.toggle")}
          className="transition-colors duration-200 hover:bg-sidebar-hover"
        >
          <Icon className={cn("h-3.5 w-3.5", spinClass)} />
          <span className="sr-only">{t("theme.toggle")}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{currentLabel}</TooltipContent>
    </Tooltip>
  ) : (
    <Button
      variant="ghost"
      aria-label={t("theme.toggle")}
      className="flex-1 justify-center transition-colors duration-200 hover:bg-sidebar-hover"
      size="sm"
    >
      <Icon className={cn("h-4 w-4", spinClass)} />
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        side={collapsed ? "right" : "top"}
        align="start"
        className="min-w-[7rem] rounded-lg border-border bg-popover shadow-elevated"
      >
        <DropdownMenuRadioGroup value={current} onValueChange={setTheme}>
          {THEME_OPTIONS.map(({ value, icon: ItemIcon, labelKey }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className="gap-2 rounded-md text-xs"
            >
              <ItemIcon className="h-3.5 w-3.5 text-muted-foreground" />
              {t(labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
