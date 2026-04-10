"use client";

import { Download, Check } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "@/i18n";
import { cn } from "@/shared/lib/utils";
import {
  fileIcon,
  fileExtension,
  formatFileSize,
  fileCategoryColor,
  fileCategoryBorderColor,
} from "@/features/agent-computer/lib/artifact-helpers";
import type { ArtifactExplorerItem } from "./artifactExplorerUtils";

// ---------------------------------------------------------------------------
// Date formatting (duplicated from ExplorerFileList to keep files independent)
// ---------------------------------------------------------------------------

function formatRelativeDate(dateStr: string, locale: string): { relative: string; absolute: string } {
  const date = new Date(dateStr);
  const absolute = date.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  let relative: string;
  if (diffSec < 60) relative = rtf.format(0, "second");
  else if (diffMin < 60) relative = rtf.format(-diffMin, "minute");
  else if (diffHr < 24) relative = rtf.format(-diffHr, "hour");
  else if (diffDays < 7) relative = rtf.format(-diffDays, "day");
  else relative = absolute;

  return { relative, absolute };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExplorerListRowProps {
  item: ArtifactExplorerItem;
  index: number;
  isSelected: boolean;
  isMultiSelectMode: boolean;
  onPreview: (item: ArtifactExplorerItem) => void;
  onToggleSelection: (id: string) => void;
  onDownload: (item: ArtifactExplorerItem) => void;
  /** Hide the conversation title label below the filename (e.g. when rendered inside a group with a visible header) */
  hideConversationLabel?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExplorerListRow({
  item,
  index,
  isSelected,
  isMultiSelectMode,
  onPreview,
  onToggleSelection,
  onDownload,
  hideConversationLabel = false,
}: ExplorerListRowProps) {
  const { t, locale } = useTranslation();
  const ext = fileExtension(item.name);
  const sizeText = formatFileSize(item.size, t);
  const { relative: relativeDate, absolute: absoluteDate } = item.createdAt
    ? formatRelativeDate(item.createdAt, locale)
    : { relative: "", absolute: "" };
  const accentBorderColor = fileCategoryBorderColor(item.contentType, item.name);
  const { icon: iconColor } = fileCategoryColor(item.contentType, item.name);
  const IconComponent = fileIcon(item.contentType, item.name);

  return (
    <motion.div
      className={cn(
        "flex items-center gap-3 px-3 border-b border-border last:border-b-0",
        "border-l-2 transition-colors duration-150 ease-out group relative",
        isSelected
          ? "bg-secondary/70 border-l-border-strong"
          : "hover:bg-secondary/50",
      )}
      style={isSelected ? undefined : { borderLeftColor: accentBorderColor }}
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.1, delay: Math.min(index * 0.01, 0.15) }}
    >
      {/* Selection checkbox */}
      <button
        type="button"
        aria-pressed={isSelected}
        aria-label={isSelected ? `Deselect ${item.name}` : `Select ${item.name}`}
        onClick={(e) => { e.stopPropagation(); onToggleSelection(item.id); }}
        className={cn(
          "shrink-0 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-[color,background-color,border-color,opacity] duration-200",
          isSelected
            ? "opacity-100 bg-primary border-border-strong text-primary-foreground"
            : "opacity-0 border-border bg-muted hover:border-border-strong group-hover:opacity-100",
          "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        {isSelected && <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />}
      </button>

      {/* File icon */}
      <div className="shrink-0 flex items-center justify-center w-6 h-6">
        <IconComponent aria-hidden="true" className={cn("h-5 w-5", iconColor)} />
      </div>

      {/* Name + conversation label — clickable to preview */}
      <button
        type="button"
        data-file-card-preview="true"
        aria-label={`Preview ${item.name}`}
        onClick={() => onPreview(item)}
        className="flex-1 min-w-0 py-[11px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <p className="truncate text-sm font-medium text-foreground leading-snug" title={item.name}>
          {item.name}
        </p>
        {!hideConversationLabel && item.conversationTitle && (
          <p className="truncate text-xs text-muted-foreground-dim mt-0.5">
            {item.conversationTitle}
          </p>
        )}
      </button>

      {/* Metadata: type badge + size + date */}
      <div className="shrink-0 hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
        {ext && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-micro uppercase tracking-wide text-muted-foreground">
            {ext}
          </span>
        )}
        <span className="w-14 text-right">{sizeText}</span>
        {relativeDate && (
          <span className="w-20 text-right" title={absoluteDate}>
            {relativeDate}
          </span>
        )}
      </div>

      {/* Download button — revealed on hover */}
      {!isMultiSelectMode && (
        <button
          type="button"
          aria-label={`Download ${item.name}`}
          onClick={(e) => { e.stopPropagation(); onDownload(item); }}
          className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </motion.div>
  );
}
