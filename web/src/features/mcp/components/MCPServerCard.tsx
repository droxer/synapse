"use client";

import { Trash2, Blocks, Radio, Wrench, Globe, Pencil } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { ToolingCard } from "@/shared/components/ToolingCard";
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

  const badge = (
    <span
      className={cn(
        "status-pill status-neutral chip-xs shrink-0 transition-opacity duration-200",
        isDisabled && "opacity-60",
      )}
    >
      <TransportIcon className="mr-1 h-2.5 w-2.5" />
      {transport.label}
    </span>
  );

  const headerActions = (
    <>
      {onEdit && server.editable !== false && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("mcp.editServer", { name: server.name })}
              className="shrink-0 text-steel hover:bg-surface-soft hover:text-ink-deep"
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
          className="shrink-0 text-steel hover:bg-critical/10 hover:text-critical"
          onClick={() => onDelete(server.name)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </>
  );

  const footerRight = onToggle ? (
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
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full transition-colors duration-150",
          isDisabled ? "bg-border-strong" : "bg-accent-emerald",
        )}
      />
      {isDisabled ? t("mcp.disabled") : t("mcp.enabled")}
    </button>
  ) : null;

  return (
    <ToolingCard
      icon={
        <Blocks
          className={cn("h-4 w-4", isDisabled ? "text-stone" : "text-steel")}
        />
      }
      badge={badge}
      headerActions={headerActions}
      title={server.name}
      body={
        <div
          className={cn(
            "flex items-center gap-3 text-xs",
            isDisabled ? "text-stone" : "text-steel",
          )}
        >
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
      }
      footerLeft={
        <span className="truncate font-mono text-micro text-stone">
          {server.url || " "}
        </span>
      }
      footerRight={footerRight}
      disabled={isDisabled}
    />
  );
}
