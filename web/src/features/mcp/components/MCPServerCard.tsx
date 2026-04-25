"use client";

import { Trash2, Blocks, Radio, Wrench, Globe, Pencil } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import {
  TOOLING_STATUS_TOGGLE_CLASSES,
  TOOLING_STATUS_TOGGLE_DISABLED_CLASSES,
  TOOLING_STATUS_TOGGLE_ENABLED_CLASSES,
} from "@/shared/lib/tooling-ui-styles";
import { useTranslation } from "@/i18n";
import type { MCPServer } from "../api/mcp-api";

const transportStyle = {
  sse: { icon: Radio, label: "sse" },
  streamablehttp: { icon: Globe, label: "streamablehttp" },
} as const;

interface MCPServerCardProps {
  readonly server: MCPServer;
  readonly onEdit?: (server: MCPServer) => void;
  readonly onDelete?: (name: string) => void;
  readonly onToggle?: (name: string, enabled: boolean) => void;
}

export function MCPServerCard({
  server,
  onEdit,
  onDelete,
  onToggle,
}: MCPServerCardProps) {
  const { t } = useTranslation();
  const transport = transportStyle[server.transport];
  const TransportIcon = transport.icon;
  const isDisabled = server.enabled === false;

  return (
    <div className={cn(
      "surface-panel group flex h-full flex-col p-4 transition-[border-color,background-color] duration-200 ease-out",
      isDisabled
        ? "opacity-90"
        : "hover:border-border-active hover:bg-secondary",
    )}>
      {/* Top row: icon + transport badge + delete */}
      <div className="flex items-start justify-between gap-2">
        <div className="chip-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors duration-200">
          <Blocks className={cn(
            "h-4 w-4 transition-colors duration-200",
            isDisabled ? "text-muted-foreground-dim" : "text-muted-foreground",
          )} />
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "status-pill status-neutral chip-xs shrink-0 transition-opacity duration-200",
              isDisabled && "opacity-60",
            )}
          >
            <TransportIcon className="mr-1 h-2.5 w-2.5" />
            {transport.label}
          </span>
          {onEdit && server.editable !== false && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("mcp.editServer", { name: server.name })}
                  className={cn(
                    "shrink-0 text-muted-foreground transition-[background-color,color,opacity]",
                    "hover:text-foreground hover:bg-muted",
                  )}
                  onClick={() => onEdit(server)}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("mcp.editServer", { name: server.name })}
              </TooltipContent>
            </Tooltip>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${t("mcp.remove")} ${server.name}`}
              className={cn(
                "shrink-0 text-muted-foreground transition-[background-color,color,opacity]",
                "hover:text-destructive hover:bg-destructive/10",
              )}
              onClick={() => onDelete(server.name)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Name */}
      <h3 className={cn(
        "mt-3 text-sm font-semibold leading-snug transition-colors duration-200",
        isDisabled ? "text-muted-foreground" : "text-foreground",
      )}>
        {server.name}
      </h3>

      {/* Details: tool count + status */}
      <div className={cn(
        "mt-1.5 min-h-[2.5rem] flex items-center gap-3 text-xs transition-colors duration-200",
        isDisabled ? "text-muted-foreground-dim" : "text-muted-foreground",
      )}>
        <span className="flex items-center gap-1">
          <Wrench className="h-3 w-3" />
          {server.tool_count === 1
            ? t("mcp.toolCount", { count: 1 })
            : t("mcp.toolsCount", { count: server.tool_count })}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors duration-200",
              isDisabled
                ? "bg-border-strong"
                : server.status === "connected"
                  ? "bg-accent-emerald"
                  : "bg-border-strong",
            )}
          />
          {server.status === "connected" && !isDisabled
            ? t("mcp.connected")
            : t("mcp.disconnected")}
        </span>
      </div>

      {/* Footer: URL + status toggle */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span className="truncate font-mono text-micro text-muted-foreground-dim">
          {server.url || "\u00A0"}
        </span>
        {onToggle && (
          <button
            type="button"
            role="switch"
            aria-checked={!isDisabled}
            aria-label={`${isDisabled ? t("mcp.enable") : t("mcp.disable")} ${server.name}`}
            className={cn(
              TOOLING_STATUS_TOGGLE_CLASSES,
              isDisabled
                ? TOOLING_STATUS_TOGGLE_DISABLED_CLASSES
                : TOOLING_STATUS_TOGGLE_ENABLED_CLASSES,
            )}
            onClick={() => onToggle(server.name, isDisabled)}
          >
            <span className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors duration-150",
              isDisabled ? "bg-border-strong" : "bg-accent-emerald",
            )} />
            {isDisabled ? t("mcp.disabled") : t("mcp.enabled")}
          </button>
        )}
      </div>
    </div>
  );
}
