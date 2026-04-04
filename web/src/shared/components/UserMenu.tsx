"use client";

import { useState, useCallback } from "react";
import { signOut, useSession } from "next-auth/react";
import { LogOut, Settings } from "lucide-react";
import { PreferencesDialog } from "@/features/preferences/PreferencesDialog";
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
import { useTranslation } from "@/i18n";
import { useUserPreferences } from "@/shared/hooks/use-user-preferences";

interface UserMenuProps {
  collapsed?: boolean;
}

export function UserMenu({ collapsed = false }: UserMenuProps) {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  // Keep preferences hook active so backend sync runs on login
  useUserPreferences();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleOpenSettings = useCallback(() => {
    setPopoverOpen(false);
    setSettingsOpen(true);
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
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
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
            className="w-56 animate-in fade-in duration-100 rounded-lg border-border bg-card shadow-[var(--shadow-elevated)] p-0"
          >
            <ProfilePopoverContent
              name={name}
              email={email}
              t={t}
              onOpenSettings={handleOpenSettings}
            />
          </PopoverContent>
        </Popover>
        <PreferencesDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    );
  }

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
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
        className="w-56 animate-in fade-in duration-100 rounded-lg border-border bg-card shadow-[var(--shadow-elevated)] p-0"
      >
        <ProfilePopoverContent
          name={name}
          email={email}
          t={t}
          onOpenSettings={handleOpenSettings}
        />
      </PopoverContent>
      <PreferencesDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Popover>
  );
}

function ProfilePopoverContent({
  name,
  email,
  t,
  onOpenSettings,
}: {
  name: string | null | undefined;
  email: string | null | undefined;
  t: (key: string, params?: Record<string, string | number>) => string;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex flex-col">
      {/* User info */}
      <div className="px-3 py-3">
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p>
      </div>

      <div className="border-t border-border" />

      {/* Actions */}
      <div className="p-1.5">
        <button
          type="button"
          onClick={onOpenSettings}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm",
            "text-foreground transition-colors duration-150",
            "hover:bg-accent",
          )}
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
