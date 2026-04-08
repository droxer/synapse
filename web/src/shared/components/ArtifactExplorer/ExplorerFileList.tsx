"use client";

import { useRef, useCallback, useState } from "react";
import { Download, Trash2, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "@/i18n";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import {
  fileIcon,
  fileExtension,
  formatFileSize,
  fileCategoryColor,
  fileCategoryBorderColor,
} from "@/features/agent-computer/lib/artifact-helpers";
import type { ArtifactExplorerItem, ConversationNode } from "./artifactExplorerUtils";
import { ExplorerListRow } from "./ExplorerListRow";

// Exported so LibraryPage skeleton can mirror the same grid layout
export const GRID_COLS_CLASS = "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4";

// ---------------------------------------------------------------------------
// Date formatting
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
// Thumbnail
// ---------------------------------------------------------------------------

interface FileThumbnailProps {
  item: ArtifactExplorerItem;
  /** "grid" = tall top area (page mode); "list" = small square (panel mode) */
  layout: "grid" | "list";
}

function FileThumbnail({ item, layout }: FileThumbnailProps) {
  const isImage = item.contentType.startsWith("image/");
  const isCode =
    item.contentType.startsWith("text/x-") ||
    item.contentType === "text/javascript" ||
    item.contentType === "application/json";
  const isPdf = item.contentType === "application/pdf";
  const isSpreadsheet =
    item.contentType === "text/csv" || item.contentType.includes("spreadsheetml");
  const isHtml = item.contentType === "text/html";

  const artifactUrl =
    item.conversationId
      ? `/api/conversations/${item.conversationId}/artifacts/${item.id}`
      : null;

  const { bg, icon: iconColor } = fileCategoryColor(item.contentType, item.name);
  const Icon = fileIcon(item.contentType, item.name);

  // ── Small square for list layout ─────────────────────────────────────────
  if (layout === "list") {
    return (
      <div className={`h-12 w-12 shrink-0 rounded-lg overflow-hidden ${bg} flex items-center justify-center`}>
        {isImage && artifactUrl ? (
          <img
            src={artifactUrl}
            alt={item.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <Icon className={`h-5 w-5 ${iconColor}`} />
        )}
      </div>
    );
  }

  // ── Full-width thumbnail for grid layout ──────────────────────────────────

  // Real image thumbnail
  if (isImage && artifactUrl) {
    return (
      <div className="h-36 overflow-hidden bg-muted/50">
        <img
          src={artifactUrl}
          alt={item.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 ease-out"
          loading="lazy"
        />
      </div>
    );
  }

  // Code file preview — synthetic syntax lines
  if (isCode) {
    return (
      <div className={`h-36 overflow-hidden ${bg} relative p-4`}>
        {/* Decorative code lines mimicking syntax structure */}
        <div className="flex flex-col gap-[7px] opacity-80">
          <div className="flex gap-1.5 items-center">
            <div className={`h-[5px] w-9 rounded-full ${iconColor}`} />
            <div className="h-[5px] w-5 rounded-full bg-current opacity-20" />
            <div className={`h-[5px] w-6 rounded-full ${iconColor} opacity-50`} />
          </div>
          <div className="flex gap-1.5 items-center pl-4">
            <div className="h-[5px] w-10 rounded-full bg-current opacity-15" />
            <div className={`h-[5px] w-4 rounded-full ${iconColor} opacity-60`} />
          </div>
          <div className="flex gap-1.5 items-center pl-4">
            <div className="h-[5px] w-14 rounded-full bg-current opacity-10" />
            <div className="h-[5px] w-7 rounded-full bg-current opacity-20" />
          </div>
          <div className="flex gap-1.5 items-center pl-8">
            <div className={`h-[5px] w-8 rounded-full ${iconColor} opacity-40`} />
            <div className="h-[5px] w-12 rounded-full bg-current opacity-15" />
          </div>
          <div className="flex gap-1.5 items-center pl-4">
            <div className="h-[5px] w-6 rounded-full bg-current opacity-20" />
          </div>
          <div className="flex gap-1.5 items-center">
            <div className="h-[5px] w-16 rounded-full bg-current opacity-10" />
          </div>
        </div>
        <Icon className={`absolute bottom-3 right-3 h-8 w-8 ${iconColor} opacity-10`} />
      </div>
    );
  }

  // PDF — page-fold design
  if (isPdf) {
    return (
      <div className={`h-36 overflow-hidden ${bg} flex items-center justify-center relative`}>
        <div className="relative flex items-center justify-center w-16 h-20">
          {/* Page body */}
          <div className="absolute inset-0 rounded-sm border-2 border-current opacity-20" />
          {/* Page fold corner */}
          <div
            className={`absolute top-0 right-0 w-4 h-4 ${bg}`}
            style={{ clipPath: "polygon(0 0, 100% 100%, 100% 0)" }}
          />
          <div
            className="absolute top-0 right-0 w-4 h-4 border-l-2 border-b-2 border-current opacity-25"
            style={{ clipPath: "polygon(0 0, 100% 100%, 0 100%)" }}
          />
          {/* PDF text lines */}
          <div className="flex flex-col gap-1.5 mt-3 px-2">
            <div className={`h-[3px] rounded-full bg-current ${iconColor} opacity-40`} style={{ width: "80%" }} />
            <div className="h-[3px] rounded-full bg-current opacity-20" style={{ width: "60%" }} />
            <div className="h-[3px] rounded-full bg-current opacity-20" style={{ width: "70%" }} />
          </div>
        </div>
        <Icon className={`absolute bottom-3 right-3 h-6 w-6 ${iconColor} opacity-20`} />
      </div>
    );
  }

  // Spreadsheet — grid pattern
  if (isSpreadsheet) {
    return (
      <div className={`h-36 overflow-hidden ${bg} relative flex items-center justify-center`}>
        <div className="grid grid-cols-3 gap-px opacity-30">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className={`h-4 w-10 rounded-sm border border-current opacity-40 ${i < 3 ? iconColor : ""}`}
            />
          ))}
        </div>
        <Icon className={`absolute bottom-3 right-3 h-6 w-6 ${iconColor} opacity-20`} />
      </div>
    );
  }

  // HTML — faint browser frame hint
  if (isHtml) {
    return (
      <div className={`h-36 overflow-hidden ${bg} relative p-3`}>
        {/* Browser-chrome-like bar */}
        <div className="flex gap-1 mb-2 items-center">
          <div className="h-2 w-2 rounded-full bg-current opacity-25" />
          <div className="h-2 w-2 rounded-full bg-current opacity-25" />
          <div className="h-2 w-2 rounded-full bg-current opacity-25" />
          <div className="flex-1 h-2 rounded-full bg-current opacity-10 ml-1" />
        </div>
        {/* Content lines */}
        <div className="flex flex-col gap-[6px]">
          <div className={`h-[5px] rounded-sm bg-current ${iconColor} opacity-50`} style={{ width: "70%" }} />
          <div className="h-[5px] rounded-sm bg-current opacity-10" style={{ width: "90%" }} />
          <div className="h-[5px] rounded-sm bg-current opacity-10" style={{ width: "80%" }} />
          <div className="h-[5px] rounded-sm bg-current opacity-10" style={{ width: "85%" }} />
          <div className="h-[5px] rounded-sm bg-current opacity-10" style={{ width: "60%" }} />
        </div>
        <Icon className={`absolute bottom-3 right-3 h-6 w-6 ${iconColor} opacity-15`} />
      </div>
    );
  }

  // Default — large icon placeholder with subtle gradient
  return (
    <div className={`h-36 overflow-hidden ${bg} flex items-center justify-center relative`}>
      <Icon className={`h-14 w-14 ${iconColor} opacity-20`} />
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/5" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExplorerFileListProps {
  items: readonly ArtifactExplorerItem[];
  groups?: readonly ConversationNode[];
  selectedFileId: string | null;
  selectedIds: ReadonlySet<string>;
  conversationId?: string;
  onSelectFile: (id: string) => void;
  onPreview: (item: ArtifactExplorerItem) => void;
  onDownload: (item: ArtifactExplorerItem) => void;
  onToggleSelection: (id: string) => void;
  onSelectAll: (ids: readonly string[]) => void;
  onDeleteSelected: () => void;
  mode: "panel" | "page";
  /** Page mode only: "grid" (default) or "list" */
  viewMode?: "grid" | "list";
}

// ---------------------------------------------------------------------------
// File Card
// ---------------------------------------------------------------------------

interface FileCardProps {
  item: ArtifactExplorerItem;
  index: number;
  isSelected: boolean;
  isMultiSelectMode: boolean;
  layout: "grid" | "list";
  onPreview: (item: ArtifactExplorerItem) => void;
  onToggleSelection: (id: string) => void;
  onDownload: (item: ArtifactExplorerItem) => void;
}

function FileCard({
  item,
  index,
  isSelected,
  isMultiSelectMode,
  layout,
  onPreview,
  onToggleSelection,
  onDownload,
}: FileCardProps) {
  const { t, locale } = useTranslation();
  const ext = fileExtension(item.name);
  const sizeText = formatFileSize(item.size, t);
  const { relative: relativeDate, absolute: absoluteDate } = item.createdAt
    ? formatRelativeDate(item.createdAt, locale)
    : { relative: "", absolute: "" };
  const accentBorderColor = fileCategoryBorderColor(item.contentType, item.name);
  const { icon: iconColor } = fileCategoryColor(item.contentType, item.name);

  // ── Grid card (vertical — thumbnail on top) ───────────────────────────────
  if (layout === "grid") {
    return (
      <motion.div
        className={[
          "rounded-lg bg-card border overflow-hidden transition-[border-color,background-color] duration-200 ease-out cursor-pointer flex flex-col relative group text-left w-full",
          "border-l-2",
          isSelected
            ? "ring-2 ring-ring ring-offset-2 ring-offset-background border-border border-l-primary"
            : "border-border hover:border-border-strong hover:bg-muted/40",
        ].join(" ")}
        style={isSelected ? undefined : { borderLeftColor: accentBorderColor }}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.12, delay: Math.min(index * 0.02, 0.2) }}
      >
        {/* Thumbnail area */}
        <div className="relative">
          <button
            type="button"
            data-file-card-preview="true"
            onClick={() => onPreview(item)}
            onKeyDown={(e) => {
              if (e.key === " ") { e.preventDefault(); onToggleSelection(item.id); }
            }}
            className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <FileThumbnail item={item} layout="grid" />
          </button>

            {/* Controls overlay on thumbnail */}

            {/* Download — top-left */}
            {!isMultiSelectMode && (
              <button
                type="button"
                data-slot="button"
                aria-label={`Download ${item.name}`}
                className="absolute top-2 left-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-muted opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={(e) => { e.stopPropagation(); onDownload(item); }}
              >
                <Download className="h-3 w-3 text-foreground" />
              </button>
            )}

            {/* Selection checkbox — top-right */}
            <button
              type="button"
              data-slot="button"
              aria-pressed={isSelected}
              aria-label={isSelected ? `Deselect ${item.name}` : `Select ${item.name}`}
              className={cn(
                "absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-[color,background-color,border-color,opacity] duration-200 ease-out",
                isSelected
                  ? "opacity-100 bg-primary border-primary text-primary-foreground"
                  : "opacity-0 border-border bg-muted hover:border-border-strong group-hover:opacity-100 group-focus-within:opacity-100",
                "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
              onClick={(e) => { e.stopPropagation(); onToggleSelection(item.id); }}
            >
              {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
            </button>
        </div>

        {/* Info area */}
        <button
          type="button"
          data-file-card-preview="true"
          onClick={() => onPreview(item)}
          onKeyDown={(e) => {
            if (e.key === " ") { e.preventDefault(); onToggleSelection(item.id); }
          }}
          className="w-full p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <div className="flex flex-col gap-1">
            <p className="truncate text-xs font-medium text-foreground leading-snug" title={item.name}>
              {item.name}
            </p>
            <div className="flex items-center gap-1.5">
              {ext && (
                <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-micro uppercase tracking-wide text-muted-foreground">
                  {ext}
                </span>
              )}
              <p className="text-micro text-muted-foreground-dim truncate">
                {sizeText}
                {relativeDate && <span title={absoluteDate}> · {relativeDate}</span>}
              </p>
            </div>
          </div>
        </button>
      </motion.div>
    );
  }

  // ── List card (horizontal — thumbnail on left) ────────────────────────────
  return (
    <motion.div
      className={[
        "rounded-lg bg-card border p-2.5 transition-[border-color,background-color] duration-200 ease-out cursor-pointer flex items-center gap-3 relative group text-left w-full",
        "border-l-2",
        isSelected
          ? "ring-2 ring-ring ring-offset-2 ring-offset-background border-border border-l-primary bg-muted/50"
          : "border-border hover:border-border-strong hover:bg-secondary",
      ].join(" ")}
      style={isSelected ? undefined : { borderLeftColor: accentBorderColor }}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.02, 0.18) }}
    >
      <button
        type="button"
        data-file-card-preview="true"
        onClick={() => onPreview(item)}
        onKeyDown={(e) => {
          if (e.key === " ") { e.preventDefault(); onToggleSelection(item.id); }
        }}
        className="flex flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {/* Small thumbnail */}
        <FileThumbnail item={item} layout="list" />

        {/* Info */}
        <div className="flex flex-col min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground" title={item.name}>
            {item.name}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {ext && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-micro uppercase text-muted-foreground">
                {ext}
              </span>
            )}
            <p className="text-xs text-muted-foreground truncate">
              {sizeText}
              {relativeDate && <span title={absoluteDate}> · {relativeDate}</span>}
            </p>
          </div>
        </div>
      </button>

      {/* Right side controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Download */}
        {!isMultiSelectMode && (
          <button
            type="button"
            data-slot="button"
            aria-label={`Download ${item.name}`}
            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 h-6 w-6 rounded-full border border-muted-foreground/30 bg-background flex items-center justify-center hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={(e) => { e.stopPropagation(); onDownload(item); }}
          >
            <Download className={cn("h-3 w-3", iconColor)} />
          </button>
        )}

        {/* Selection checkbox */}
        <button
          type="button"
          data-slot="button"
          aria-pressed={isSelected}
          aria-label={isSelected ? `Deselect ${item.name}` : `Select ${item.name}`}
          className={cn(
            "h-5 w-5 rounded-full border flex items-center justify-center transition-[color,background-color,border-color,opacity]",
            isSelected
              ? "opacity-100 bg-primary border-primary text-primary-foreground"
              : "opacity-20 border-muted-foreground/50 bg-background hover:border-primary group-hover:opacity-100 group-focus-within:opacity-100",
            "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
          onClick={(e) => { e.stopPropagation(); onToggleSelection(item.id); }}
        >
          {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function ExplorerFileList({
  items,
  groups,
  selectedFileId,
  selectedIds,
  onSelectFile,
  onPreview,
  onDownload,
  onToggleSelection,
  onDeleteSelected,
  mode,
  viewMode = "grid",
}: ExplorerFileListProps) {
  const { t, locale } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const isMultiSelectMode = selectedIds.size > 0;
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) return;

      const currentIndex = items.findIndex((item) => item.id === selectedFileId);
      if (currentIndex === -1 && items.length > 0) {
        onSelectFile(items[0].id);
        return;
      }

      let nextIndex = currentIndex;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      }

      const nextItem = items[nextIndex];
      if (nextItem) {
        e.preventDefault();
        onSelectFile(nextItem.id);
        const cards = containerRef.current?.querySelectorAll<HTMLElement>("[data-file-card-preview='true']");
        cards?.[nextIndex]?.focus();
      }
    },
    [items, selectedFileId, onSelectFile],
  );

  const handleDownloadSelected = useCallback(() => {
    items.filter((i) => selectedIds.has(i.id)).forEach((item) => onDownload(item));
  }, [items, selectedIds, onDownload]);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-5">
        <p className="text-xs text-muted-foreground">
          {t("explorer.emptyFolder")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col relative">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4"
        onKeyDown={handleContainerKeyDown}
        aria-label={t("explorer.fileListLabel")}
      >
        {mode === "panel" ? (
          <div className="flex flex-col gap-2">
            {items.map((item, i) => (
              <FileCard
                key={item.id}
                item={item}
                index={i}
                layout="list"
                isSelected={selectedIds.has(item.id)}
                isMultiSelectMode={isMultiSelectMode}
                onPreview={onPreview}
                onToggleSelection={onToggleSelection}
                onDownload={onDownload}
              />
            ))}
          </div>
        ) : viewMode === "list" ? (
          <div>
            {groups?.map((group) => {
              const groupItems = items.filter((item) => item.conversationId === group.id);
              if (groupItems.length === 0) return null;

              const { relative: groupDate, absolute: groupAbsDate } = formatRelativeDate(group.createdAt, locale);

              return (
                <div key={group.id} className="mb-8 last:mb-0">
                  <div className="flex items-center gap-3 mb-3 mt-8 first:mt-0 pb-3 border-b border-border">
                    <h3 className="text-sm font-semibold text-foreground truncate flex-1">
                      {group.title}
                    </h3>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t(groupItems.length === 1 ? "library.statsFile" : "library.statsFiles", { count: groupItems.length })}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground-dim" title={groupAbsDate}>
                      {groupDate}
                    </span>
                  </div>
                  <div className="flex flex-col rounded-lg border border-border overflow-hidden">
                    {groupItems.map((item, i) => (
                      <ExplorerListRow
                        key={item.id}
                        item={item}
                        index={i}
                        isSelected={selectedIds.has(item.id)}
                        isMultiSelectMode={isMultiSelectMode}
                        onPreview={onPreview}
                        onToggleSelection={onToggleSelection}
                        onDownload={onDownload}
                        hideConversationLabel
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            {groups?.map((group) => {
              const groupItems = items.filter((item) => item.conversationId === group.id);
              if (groupItems.length === 0) return null;

              const { relative: groupDate, absolute: groupAbsDate } = formatRelativeDate(group.createdAt, locale);

              return (
                <div key={group.id} className="mb-8 last:mb-0">
                  <div className="flex items-center gap-3 mb-4 mt-8 first:mt-0 pb-3 border-b border-border">
                    <h3 className="text-sm font-semibold text-foreground truncate flex-1">
                      {group.title}
                    </h3>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t(groupItems.length === 1 ? "library.statsFile" : "library.statsFiles", { count: groupItems.length })}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground-dim" title={groupAbsDate}>
                      {groupDate}
                    </span>
                  </div>
                  <div className={GRID_COLS_CLASS}>
                    {groupItems.map((item, i) => (
                      <FileCard
                        key={item.id}
                        item={item}
                        index={i}
                        layout="grid"
                        isSelected={selectedIds.has(item.id)}
                        isMultiSelectMode={isMultiSelectMode}
                        onPreview={onPreview}
                        onToggleSelection={onToggleSelection}
                        onDownload={onDownload}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 50, opacity: 0, x: "-50%" }}
            animate={{ y: 0, opacity: 1, x: "-50%" }}
            exit={{ y: 50, opacity: 0, x: "-50%" }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-popover rounded-full shadow-lg px-6 py-3 flex items-center gap-4 z-50 border border-border"
          >
            <span className="text-sm font-medium whitespace-nowrap">
              {t("explorer.selectedCount", { count: selectedIds.size })}
            </span>
            <div className="h-4 w-px bg-border shrink-0" />
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 rounded-full hover:bg-muted shrink-0"
              onClick={handleDownloadSelected}
            >
              <Download className="h-4 w-4" />
              {t("explorer.downloadAll")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 rounded-full shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setIsDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              {t("explorer.delete")}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("explorer.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("explorer.deleteConfirmDesc", { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">
              {t("explorer.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              onClick={onDeleteSelected}
            >
              {t("explorer.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
