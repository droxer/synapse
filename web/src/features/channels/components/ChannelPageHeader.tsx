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
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 bg-background px-4">
      {/* Left: title + live badge */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Radio className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{t("channels.title")}</h1>
        {telegramConfigured && (
          <span className="status-pill status-ok shrink-0">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent-emerald" />
            {t("channels.header.live")}
          </span>
        )}
      </div>

      {/* Right: settings + search */}
      <div className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSettings}
              aria-label={t("channels.header.telegramSettings")}
              className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
              {telegramConfigured && (
                <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent-emerald ring-1 ring-background" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("channels.header.telegramSettings")}</TooltipContent>
        </Tooltip>

        <Button
          type="button"
          onClick={handleOpenCommandPalette}
          variant="secondary"
          size="sm"
          className="shrink-0 gap-2 text-muted-foreground hover:text-foreground"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">{t("channels.header.search")}</span>
          <kbd className="hidden sm:inline rounded bg-background px-1 py-0.5 font-mono text-micro text-muted-foreground-dim ring-1 ring-border">⌘K</kbd>
        </Button>
      </div>
    </header>
  );
}
