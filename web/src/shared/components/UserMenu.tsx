"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut, Settings } from "lucide-react";
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
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { LanguageSwitcher } from "@/shared/components/LanguageSwitcher";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";

interface UserMenuProps {
  collapsed?: boolean;
}

export function UserMenu({ collapsed = false }: UserMenuProps) {
  const { data: session, status } = useSession();
  const { t } = useTranslation();

  if (status === "loading") {
    return (
      <div
        className={cn(
          "animate-pulse rounded-lg bg-secondary",
          collapsed ? "mx-auto h-9 w-9 rounded-full" : "h-[88px] w-full",
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
            className="w-56 animate-[scaleIn_0.15s_ease-out] p-0"
          >
            <ProfilePopoverContent name={name} email={email} t={t} />
          </PopoverContent>
        </Popover>
        <LanguageSwitcher collapsed />
        <ThemeToggle collapsed />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Profile trigger + popover */}
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
          className="w-56 animate-[scaleIn_0.15s_ease-out] p-0"
        >
          <ProfilePopoverContent name={name} email={email} t={t} />
        </PopoverContent>
      </Popover>

      {/* Settings row: language + theme */}
      <div className="flex items-center gap-1.5 rounded-lg bg-secondary p-1">
        <LanguageSwitcher />
        <div className="h-4 w-px shrink-0 bg-border" />
        <ThemeToggle />
      </div>
    </div>
  );
}

function ProfilePopoverContent({
  name,
  email,
  t,
}: {
  name: string | null | undefined;
  email: string | null | undefined;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col">
      <div className="px-3 py-3">
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p>
      </div>
      <div className="border-t border-border" />
      <div className="p-1">
        <button
          type="button"
          disabled
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground opacity-50"
        >
          <Settings className="h-4 w-4" />
          {t("profile.settings")}
        </button>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm",
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
