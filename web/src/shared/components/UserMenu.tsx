"use client";

import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { LogOut, Settings, Sun, Moon, Monitor, Globe } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarBadge,
} from "@/shared/components/ui/avatar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import { useTranslation, LOCALES, type Locale } from "@/i18n";
import { useTheme } from "next-themes";
import { useUserPreferences } from "@/shared/hooks/use-user-preferences";

/** Short script-based labels for the language segmented toggle */
const LOCALE_SHORT: Record<Locale, string> = {
  en: "EN",
  "zh-CN": "\u7B80",
  "zh-TW": "\u7E41",
};

type ThemeValue = "light" | "dark" | "system";

const THEME_OPTIONS: readonly {
  readonly value: ThemeValue;
  readonly icon: typeof Sun;
  readonly labelKey: string;
}[] = [
  { value: "light", icon: Sun, labelKey: "theme.light" },
  { value: "dark", icon: Moon, labelKey: "theme.dark" },
  { value: "system", icon: Monitor, labelKey: "theme.system" },
];

interface UserMenuProps {
  collapsed?: boolean;
}

export function UserMenu({ collapsed = false }: UserMenuProps) {
  const { data: session, status } = useSession();
  const { t, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { savePreferences } = useUserPreferences();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (status === "loading") {
    return (
      <div
        className={cn(
          "animate-pulse rounded-lg bg-secondary",
          collapsed ? "mx-auto h-9 w-9 rounded-full" : "h-[52px] w-full",
        )}
      />
    );
  }

  if (!session?.user) {
    return null;
  }

  const { name, email, image } = session.user;
  const initials = (name ?? email ?? "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1">
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="rounded-full p-0.5 transition-shadow duration-200 hover:shadow-[0_0_0_2px_var(--color-profile-ring-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={name ?? "User menu"}
                >
                  <Avatar className="h-8 w-8 shadow-[0_0_0_2px_var(--color-profile-ring)]">
                    <AvatarImage src={image ?? undefined} alt={name ?? "User"} />
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    <AvatarBadge className="bg-accent-emerald ring-2 ring-sidebar-bg" />
                  </Avatar>
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{name}</TooltipContent>
          </Tooltip>
          <PopoverContent
            side="right"
            align="end"
            className="w-56 animate-[scaleIn_0.15s_ease-out] rounded-xl border-border bg-card shadow-[var(--shadow-elevated)] p-0"
          >
            <ProfilePopoverContent
              name={name}
              email={email}
              t={t}
              theme={mounted ? (theme as ThemeValue) ?? "dark" : "dark"}
              setTheme={setTheme}
              locale={locale}
              setLocale={setLocale}
              savePreferences={savePreferences}
              mounted={mounted}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left",
            "transition-colors duration-200",
            "hover:bg-sidebar-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <div className="rounded-full p-0.5 transition-shadow duration-200 group-hover:shadow-[0_0_0_2px_var(--color-profile-ring-hover)]">
            <Avatar className="h-9 w-9 shadow-[0_0_0_2px_var(--color-profile-ring)]">
              <AvatarImage src={image ?? undefined} alt={name ?? "User"} />
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              <AvatarBadge className="bg-accent-emerald ring-2 ring-sidebar-bg" />
            </Avatar>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              {name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {email}
            </p>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-56 animate-[scaleIn_0.15s_ease-out] rounded-xl border-border bg-card shadow-[var(--shadow-elevated)] p-0"
      >
        <ProfilePopoverContent
          name={name}
          email={email}
          t={t}
          theme={mounted ? (theme as ThemeValue) ?? "dark" : "dark"}
          setTheme={setTheme}
          locale={locale}
          setLocale={setLocale}
          savePreferences={savePreferences}
          mounted={mounted}
        />
      </PopoverContent>
    </Popover>
  );
}

function ProfilePopoverContent({
  name,
  email,
  t,
  theme,
  setTheme,
  locale,
  setLocale,
  savePreferences,
  mounted,
}: {
  name: string | null | undefined;
  email: string | null | undefined;
  t: (key: string) => string;
  theme: ThemeValue;
  setTheme: (theme: string) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  savePreferences: (prefs: { theme?: string; locale?: string }) => void;
  mounted: boolean;
}) {
  return (
    <div className="flex flex-col">
      {/* User info */}
      <div className="px-3 py-3">
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p>
      </div>

      <div className="border-t border-border" />

      {/* Language & Theme controls */}
      <div className="px-3 py-2.5 space-y-2.5">
        {/* Language row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Globe className="h-4 w-4 text-muted-foreground" />
            {t("profile.language")}
          </div>
          <div
            className="flex items-center gap-0.5 rounded-md bg-secondary p-0.5"
            role="radiogroup"
            aria-label={t("profile.language")}
          >
            {LOCALES.map((loc) => {
              const isActive = loc === locale;
              return (
                <button
                  key={loc}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => {
                    setLocale(loc);
                    savePreferences({ locale: loc });
                  }}
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-xs font-medium transition-all duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {LOCALE_SHORT[loc]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Theme row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-foreground">
            {theme === "dark" ? (
              <Moon className="h-4 w-4 text-muted-foreground" />
            ) : theme === "light" ? (
              <Sun className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Monitor className="h-4 w-4 text-muted-foreground" />
            )}
            {t("profile.theme")}
          </div>
          <div
            className="flex items-center gap-0.5 rounded-md bg-secondary p-0.5"
            role="radiogroup"
            aria-label={t("profile.theme")}
          >
            {mounted &&
              THEME_OPTIONS.map(({ value, icon: Icon, labelKey }) => {
                const isActive = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    aria-label={t(labelKey)}
                    onClick={() => {
                      setTheme(value);
                      savePreferences({ theme: value });
                    }}
                    className={cn(
                      "rounded-sm p-1 transition-all duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      isActive
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Actions */}
      <div className="p-1.5">
        <button
          type="button"
          disabled
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground opacity-50"
        >
          <Settings className="h-4 w-4" />
          {t("profile.settings")}
        </button>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm",
            "text-destructive transition-colors duration-150",
            "hover:bg-destructive/10",
          )}
        >
          <LogOut className="h-4 w-4" />
          {t("profile.signOut")}
        </button>
      </div>
    </div>
  );
}
