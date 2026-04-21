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
  orchestratorMode?: "agent" | "planner" | null;
  isPlannerAutoDetected?: boolean;
}

export function TopBar({
  taskState,
  isConnected: _isConnected,
  onNavigateHome,
  conversationTitle,
  conversationId,
  orchestratorMode,
  isPlannerAutoDetected = false,
}: TopBarProps) {
  const { t } = useTranslation();
  const { usage: convUsage } = useConversationTokenUsage(conversationId ?? null);

  const handleOpenCommandPalette = useCallback(() => {
    document.dispatchEvent(new CustomEvent("synapse:open-command-palette"));
  }, []);

  const isActive = taskState !== "idle";

  return (
    <header className="flex h-10 shrink-0 items-center justify-between bg-background px-4">
      {/* Left: Breadcrumb */}
      <div className="min-w-0 flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNavigateHome}
          aria-label={t("a11y.home")}
          className="shrink-0 gap-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        {isActive && conversationTitle && (
          <>
            <span className="text-sm text-muted-foreground-dim" aria-hidden="true">/</span>
            <span className="truncate text-sm font-medium text-foreground">
              {conversationTitle}
            </span>
            {convUsage && (convUsage.input_tokens > 0 || convUsage.output_tokens > 0) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="chip-muted chip-sm ml-2 inline-flex shrink-0 items-center gap-1 font-mono font-medium tabular-nums transition-colors hover:text-foreground">
                    <Zap className="h-3 w-3" />
                    {formatTokenCount(convUsage.input_tokens + convUsage.output_tokens)}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="font-mono text-micro tabular-nums">
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    <span className="text-muted-foreground">{t("topbar.tokensIn")}</span>
                    <span className="text-right">{convUsage.input_tokens.toLocaleString()}</span>
                    <span className="text-muted-foreground">{t("topbar.tokensOut")}</span>
                    <span className="text-right">{convUsage.output_tokens.toLocaleString()}</span>
                    <span className="text-muted-foreground">{t("topbar.requests")}</span>
                    <span className="text-right">{convUsage.request_count}</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </>
        )}
        {orchestratorMode === "planner" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-live="polite"
                className="status-pill status-neutral ml-1.5 shrink-0"
              >
                <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-focus" aria-hidden="true" />
                <span>{t("topbar.plan")}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {isPlannerAutoDetected ? t("topbar.planAutoTooltip") : t("topbar.planTooltip")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Right: Command palette trigger */}
      <Button
        type="button"
        onClick={handleOpenCommandPalette}
        variant="ghost"
        size="sm"
        className="shrink-0 gap-2 rounded-md border border-border bg-card text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline text-xs">{t("topbar.search")}</span>
        <kbd className="hidden rounded-md bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground-dim sm:inline">⌘K</kbd>
      </Button>
    </header>
  );
}
