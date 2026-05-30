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
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-hairline-soft bg-canvas px-6">
      {/* Left: Breadcrumb */}
      <div className="min-w-0 flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNavigateHome}
          aria-label={t("a11y.home")}
          className="shrink-0 gap-2 text-steel hover:bg-surface-soft hover:text-ink-deep"
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        {isActive && conversationTitle && (
          <>
            <span className="text-body-sm text-stone" aria-hidden="true">/</span>
            <span className="truncate text-body-sm-bold text-ink-deep">
              {conversationTitle}
            </span>
            {convUsage && (convUsage.input_tokens > 0 || convUsage.output_tokens > 0) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="chip-muted chip-sm ml-2 inline-flex shrink-0 items-center gap-1 font-mono tabular-nums transition-colors hover:text-ink-deep">
                    <Zap className="h-3 w-3" />
                    {formatTokenCount(convUsage.input_tokens + convUsage.output_tokens)}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="font-mono text-micro tabular-nums">
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    <span className="text-steel">{t("topbar.tokensIn")}</span>
                    <span className="text-right">{convUsage.input_tokens.toLocaleString()}</span>
                    <span className="text-steel">{t("topbar.tokensOut")}</span>
                    <span className="text-right">{convUsage.output_tokens.toLocaleString()}</span>
                    <span className="text-steel">{t("topbar.requests")}</span>
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

      {/* Right: Command palette trigger — DESIGN.md `search-pill` */}
      <button
        type="button"
        onClick={handleOpenCommandPalette}
        aria-label={t("topbar.search")}
        data-slot="search-pill"
        className="search-pill shrink-0 cursor-pointer outline-none hover:text-ink hover:border-hairline-soft focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">{t("topbar.search")}</span>
        <kbd className="hidden rounded-full bg-canvas px-2 py-0.5 font-mono text-caption-bold text-steel sm:inline">
          ⌘K
        </kbd>
      </button>
    </header>
  );
}
