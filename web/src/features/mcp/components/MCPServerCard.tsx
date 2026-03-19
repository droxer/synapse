"use client";

import { Trash2, Blocks, Terminal, Radio, Wrench } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import type { MCPServer } from "../api/mcp-api";

const transportStyle = {
  stdio: { icon: Terminal, label: "stdio" },
  sse: { icon: Radio, label: "sse" },
} as const;

interface MCPServerCardProps {
  readonly server: MCPServer;
  readonly onDelete?: (name: string) => void;
}

export function MCPServerCard({ server, onDelete }: MCPServerCardProps) {
  const { t } = useTranslation();
  const transport = transportStyle[server.transport];
  const TransportIcon = transport.icon;

  return (
    <div className="group flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:border-border-strong hover:shadow-md">
      {/* Top row: icon + transport badge + delete */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <Blocks className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-1.5">
          <Badge
            variant="secondary"
            className="text-micro font-mono font-medium px-1.5 py-0 shrink-0"
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
                "shrink-0 text-muted-foreground/0 transition-colors",
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
      <h3 className="mt-3 text-sm font-semibold leading-snug text-foreground">
        {server.name}
      </h3>

      {/* Details: tool count + status */}
      <div className="mt-1.5 min-h-[2.5rem] flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Wrench className="h-3 w-3" />
          {server.tool_count === 1
            ? t("mcp.toolCount", { count: 1 })
            : t("mcp.toolsCount", { count: server.tool_count })}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              server.status === "connected"
                ? "bg-accent-emerald"
                : "bg-muted-foreground/30",
            )}
          />
          {server.status === "connected"
            ? t("mcp.connected")
            : t("mcp.disconnected")}
        </span>
      </div>

      {/* Footer: command or URL */}
      <div className="mt-auto pt-3">
        {(server.command || server.url) && (
          <span className="truncate font-mono text-micro text-muted-foreground-dim block">
            {server.command || server.url}
          </span>
        )}
      </div>
    </div>
  );
}
