"use client";

import { useCallback } from "react";
import { LayoutGrid, Search, Zap } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/components/ui/tooltip";
import { useTranslation } from "@/i18n";
import { useConversationTokenUsage, formatTokenCount } from "@/shared/hooks/use-token-usage";
import type { TaskState } from "@/shared/types";

interface TopBarProps {
  taskState: TaskState;
  isConnected: boolean;
  onNavigateHome?: () => void;
  conversationTitle?: string;
  conversationId?: string | null;
}

export function TopBar({
  taskState,
  isConnected,
  onNavigateHome,
  conversationTitle,
  conversationId,
}: TopBarProps) {
  const { t } = useTranslation();
  const { usage: convUsage } = useConversationTokenUsage(conversationId ?? null);

  const handleOpenCommandPalette = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
  }, []);

  const isActive = taskState !== "idle";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-background px-4">
      {/* Left: Breadcrumb */}
      <div className="flex items-center gap-1.5 min-w-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNavigateHome}
          aria-label={t("a11y.home")}
          className="shrink-0 gap-2 text-muted-foreground hover:text-foreground"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>
        {isActive && conversationTitle && (
          <>
            <span className="text-sm text-muted-foreground-dim">/</span>
            <span className="truncate text-sm font-medium text-foreground">
              {conversationTitle}
            </span>
            {convUsage && (convUsage.input_tokens > 0 || convUsage.output_tokens > 0) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-2 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-purple/[0.06] px-2 py-0.5 text-micro font-medium tabular-nums font-mono text-accent-purple/70 ring-1 ring-inset ring-accent-purple/10 transition-colors hover:bg-accent-purple/[0.1] hover:text-accent-purple/90">
                    <Zap className="h-3 w-3" />
                    {formatTokenCount(convUsage.input_tokens + convUsage.output_tokens)}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="font-mono text-micro tabular-nums">
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    <span className="text-muted-foreground">in</span>
                    <span className="text-right">{convUsage.input_tokens.toLocaleString()}</span>
                    <span className="text-muted-foreground">out</span>
                    <span className="text-right">{convUsage.output_tokens.toLocaleString()}</span>
                    <span className="text-muted-foreground">req</span>
                    <span className="text-right">{convUsage.request_count}</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </>
        )}
        {isConnected && (
          <span role="status" aria-live="polite" className="ml-1.5 flex items-center">
            <span className="relative flex h-2 w-2 shrink-0">
              <span
                className="absolute inline-flex h-full w-full animate-[pulsingDotRing_2s_ease-out_infinite] rounded-full bg-accent-emerald opacity-60"
                aria-hidden="true"
              />
              <span
                className="relative inline-flex h-2 w-2 rounded-full bg-accent-emerald"
                aria-label={t("topbar.connected")}
                title={t("topbar.connected")}
              />
            </span>
          </span>
        )}
      </div>

      {/* Right: Command palette trigger */}
      <button
        type="button"
        onClick={handleOpenCommandPalette}
        className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1 text-sm text-muted-foreground shadow-[var(--shadow-card)] transition-all duration-150 hover:border-border-strong hover:bg-sidebar-active hover:text-foreground hover:shadow-[var(--shadow-card-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("topbar.search")}</span>
        <kbd className="hidden sm:inline rounded bg-background px-1 py-0.5 font-mono text-micro text-muted-foreground-dim ring-1 ring-border">⌘K</kbd>
      </button>
    </header>
  );
}
