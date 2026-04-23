"use client";

import { Trash2, Blocks, Radio, Wrench, Globe } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import type { MCPServer } from "../api/mcp-api";

const transportStyle = {
  sse: { icon: Radio, label: "sse" },
  streamablehttp: { icon: Globe, label: "streamablehttp" },
} as const;

interface MCPServerCardProps {
  readonly server: MCPServer;
  readonly onDelete?: (name: string) => void;
  readonly onToggle?: (name: string, enabled: boolean) => void;
}

export function MCPServerCard({ server, onDelete, onToggle }: MCPServerCardProps) {
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
          <Badge
            variant="secondary"
            className={cn(
              "text-micro font-mono font-medium px-1.5 py-0 shrink-0 transition-opacity duration-200",
              isDisabled && "opacity-60",
            )}
          >
            <TransportIcon className="mr-1 h-2.5 w-2.5" />
            {transport.label}
          </Badge>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${t("mcp.remove")} ${server.name}`}
              className={cn(
                "shrink-0 text-transparent transition-colors",
                "group-hover:text-muted-foreground group-focus-within:text-muted-foreground",
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
            aria-label={isDisabled ? t("mcp.enable") : t("mcp.disable")}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-micro font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isDisabled
                ? "border-border bg-secondary text-muted-foreground-dim hover:bg-secondary hover:text-muted-foreground"
                : "border-border bg-muted text-muted-foreground hover:bg-muted hover:text-foreground",
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
