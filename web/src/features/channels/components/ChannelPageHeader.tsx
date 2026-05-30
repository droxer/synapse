"use client";

import { useCallback } from "react";
import { Radio, Settings, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/shared/components/ui/tooltip";
import { useTranslation } from "@/i18n";

interface ChannelPageHeaderProps {
  telegramConfigured: boolean;
  onOpenSettings: () => void;
}

export function ChannelPageHeader({ telegramConfigured, onOpenSettings }: ChannelPageHeaderProps) {
  const { t } = useTranslation();
  const handleOpenCommandPalette = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-hairline-soft bg-canvas px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Radio className="h-4 w-4 shrink-0 text-steel" />
        <h1 className="min-w-0 truncate text-heading-sm text-ink-deep sm:text-heading-lg">{t("channels.title")}</h1>
        {telegramConfigured && (
          <span className="status-pill status-ok shrink-0">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent-emerald" />
            {t("channels.header.live")}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSettings}
              aria-label={t("channels.header.telegramSettings")}
              className="relative h-8 w-8 text-steel hover:text-ink-deep"
            >
              <Settings className="h-4 w-4" />
              {telegramConfigured && (
                <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent-emerald ring-1 ring-canvas" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("channels.header.telegramSettings")}</TooltipContent>
        </Tooltip>

        <button
          type="button"
          onClick={handleOpenCommandPalette}
          aria-label={t("channels.header.search")}
          data-slot="search-pill"
          className="search-pill shrink-0 cursor-pointer outline-none hover:text-ink hover:border-hairline-soft focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">{t("channels.header.search")}</span>
          <kbd className="hidden rounded-full bg-canvas px-2 py-0.5 font-mono text-caption-bold text-steel sm:inline">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}
