"use client";

import { useCallback } from "react";
import { Radio, Settings, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/shared/components/ui/tooltip";

interface ChannelPageHeaderProps {
  telegramConfigured: boolean;
  onOpenSettings: () => void;
}

export function ChannelPageHeader({ telegramConfigured, onOpenSettings }: ChannelPageHeaderProps) {
  const handleOpenCommandPalette = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      {/* Left: title + live badge */}
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-[#2AABEE]" />
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Channels</h1>
        {telegramConfigured && (
          <span className="flex items-center gap-1 rounded-full bg-accent-emerald/10 px-1.5 py-0.5 text-micro font-medium text-accent-emerald ring-1 ring-accent-emerald/20">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-[pulsingDotRing_2s_ease-out_infinite] rounded-full bg-accent-emerald opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-emerald" />
            </span>
            Live
          </span>
        )}
      </div>

      {/* Right: settings + search */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSettings}
              className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
              {telegramConfigured && (
                <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent-emerald ring-1 ring-background" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Telegram settings</TooltipContent>
        </Tooltip>

        <button
          type="button"
          onClick={handleOpenCommandPalette}
          className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1 text-sm text-muted-foreground transition-[color,background-color,border-color] duration-150 ease-out hover:border-border-strong hover:bg-sidebar-active hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden sm:inline rounded bg-background px-1 py-0.5 font-mono text-micro text-muted-foreground-dim ring-1 ring-border">⌘K</kbd>
        </button>
      </div>
    </header>
  );
}
