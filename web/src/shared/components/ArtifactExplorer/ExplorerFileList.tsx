"use client";

import { useRef, useCallback } from "react";
import { Download, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "@/i18n";
import { cn } from "@/shared/lib/utils";
import {
  fileExtension,
  formatFileSize,
  fileCategoryColor,
  fileCategoryBorderColor,
} from "@/features/agent-computer/lib/artifact-helpers";
import { BrandFileTypeIcon } from "@/shared/components/file-type-icons/BrandFileTypeIcon";
import { formatRelativeDate } from "@/shared/lib/format-relative-date";
import type { ArtifactExplorerItem, ConversationNode } from "./artifactExplorerUtils";
import { ExplorerListRow } from "./ExplorerListRow";

// Exported so LibraryPage skeleton can mirror the same grid layout
export const GRID_COLS_CLASS = "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4";

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
  // ── Small square for list layout ─────────────────────────────────────────
  if (layout === "list") {
    return (
      <div className={`h-12 w-12 shrink-0 rounded-lg overflow-hidden ${bg} flex items-center justify-center`}>
        {isImage && artifactUrl ? (
          <img
            src={artifactUrl}
            alt={item.name}
            width={48}
            height={48}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <BrandFileTypeIcon
            name={item.name}
            contentType={item.contentType}
            className={`h-5 w-5 ${iconColor}`}
          />
        )}
      </div>
    );
  }

  // ── Full-width thumbnail for grid layout ──────────────────────────────────

  // Real image thumbnail
  if (isImage && artifactUrl) {
    return (
      <div className="h-36 overflow-hidden bg-muted">
        <img
          src={artifactUrl}
          alt={item.name}
          width={400}
          height={144}
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
        <BrandFileTypeIcon
          name={item.name}
          contentType={item.contentType}
          className={`absolute bottom-3 right-3 h-8 w-8 ${iconColor} opacity-10`}
        />
      </div>
    );
  }

  // PDF — page-fold design
  if (isPdf) {
    return (
      <div className={`h-36 overflow-hidden ${bg} flex items-center justify-center relative`}>
        <div className="relative flex items-center justify-center w-16 h-20">
          {/* Page body */}
          <div className="absolute inset-0 rounded-sm border border-current opacity-20" />
          {/* Page fold corner */}
          <div
            className={`absolute top-0 right-0 w-4 h-4 ${bg}`}
            style={{ clipPath: "polygon(0 0, 100% 100%, 100% 0)" }}
          />
          <div
            className="absolute top-0 right-0 w-4 h-4 border-l border-b border-current opacity-25"
            style={{ clipPath: "polygon(0 0, 100% 100%, 0 100%)" }}
          />
          {/* PDF text lines */}
          <div className="flex flex-col gap-1.5 mt-3 px-2">
            <div className={`h-[3px] rounded-full bg-current ${iconColor} opacity-40`} style={{ width: "80%" }} />
            <div className="h-[3px] rounded-full bg-current opacity-20" style={{ width: "60%" }} />
            <div className="h-[3px] rounded-full bg-current opacity-20" style={{ width: "70%" }} />
          </div>
        </div>
        <BrandFileTypeIcon
          name={item.name}
          contentType={item.contentType}
          className={`absolute bottom-3 right-3 h-6 w-6 ${iconColor} opacity-20`}
        />
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
        <BrandFileTypeIcon
          name={item.name}
          contentType={item.contentType}
          className={`absolute bottom-3 right-3 h-6 w-6 ${iconColor} opacity-20`}
        />
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
        <BrandFileTypeIcon
          name={item.name}
          contentType={item.contentType}
          className={`absolute bottom-3 right-3 h-6 w-6 ${iconColor} opacity-15`}
        />
      </div>
    );
  }

  // Default — large icon placeholder.
  return (
    <div className={`h-36 overflow-hidden ${bg} flex items-center justify-center relative`}>
      <BrandFileTypeIcon
        name={item.name}
        contentType={item.contentType}
        className={`h-14 w-14 ${iconColor} opacity-20`}
      />
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
  conversationId?: string;
  /** When false, delete controls are hidden (e.g. no conversation context). */
  canDelete?: boolean;
  onSelectFile: (id: string) => void;
  onPreview: (item: ArtifactExplorerItem) => void;
  onDownload: (item: ArtifactExplorerItem) => void;
  onOpenDeleteDialog: (artifactIds: readonly string[]) => void;
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
  isPreviewOpen: boolean;
  layout: "grid" | "list";
  canDelete: boolean;
  onPreview: (item: ArtifactExplorerItem) => void;
  onDownload: (item: ArtifactExplorerItem) => void;
  onOpenDeleteDialog: (artifactIds: readonly string[]) => void;
}

function FileCard({
  item,
  index,
  isPreviewOpen,
  layout,
  canDelete,
  onPreview,
  onDownload,
  onOpenDeleteDialog,
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
          "border-l",
          isPreviewOpen
            ? "ring-1 ring-ring ring-offset-1 ring-offset-background border-border border-l-border-strong"
            : "border-border hover:border-border-strong hover:bg-muted",
        ].join(" ")}
        style={isPreviewOpen ? undefined : { borderLeftColor: accentBorderColor }}
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
            className="w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <FileThumbnail item={item} layout="grid" />
          </button>

            {/* Download — top-left */}
            <button
              type="button"
              data-slot="button"
              aria-label={`Download ${item.name}`}
              className="touch-target absolute top-2 left-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              onClick={(e) => { e.stopPropagation(); onDownload(item); }}
            >
              <Download className="h-3.5 w-3.5 text-foreground" />
            </button>

            {canDelete && (
              <button
                type="button"
                data-slot="button"
                aria-label={t("explorer.deleteFileLabel", { name: item.name })}
                className="touch-target absolute bottom-2 left-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-destructive/15 hover:text-destructive hover:border-destructive/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                onClick={(e) => { e.stopPropagation(); onOpenDeleteDialog([item.id]); }}
              >
                <Trash2 className="h-3.5 w-3.5 text-foreground" />
              </button>
            )}
        </div>

        {/* Info area */}
        <button
          type="button"
          data-file-card-preview="true"
          onClick={() => onPreview(item)}
          className="w-full p-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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
        "border-l",
        isPreviewOpen
          ? "ring-1 ring-ring ring-offset-1 ring-offset-background border-border border-l-border-strong bg-muted"
          : "border-border hover:border-border-strong hover:bg-secondary",
      ].join(" ")}
      style={isPreviewOpen ? undefined : { borderLeftColor: accentBorderColor }}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.02, 0.18) }}
    >
      <button
        type="button"
        data-file-card-preview="true"
        onClick={() => onPreview(item)}
        className="flex flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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
        {canDelete && (
          <button
            type="button"
            data-slot="button"
            aria-label={t("explorer.deleteFileLabel", { name: item.name })}
            className="touch-target h-7 w-7 rounded-full border border-border bg-background flex items-center justify-center shrink-0 transition-colors hover:border-destructive/40 hover:text-destructive hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            onClick={(e) => { e.stopPropagation(); onOpenDeleteDialog([item.id]); }}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        <button
          type="button"
          data-slot="button"
          aria-label={`Download ${item.name}`}
          className="touch-target h-7 w-7 rounded-full border border-border bg-background flex items-center justify-center shrink-0 transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          onClick={(e) => { e.stopPropagation(); onDownload(item); }}
        >
          <Download className={cn("h-3.5 w-3.5", iconColor)} />
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
  canDelete = false,
  onSelectFile,
  onPreview,
  onDownload,
  onOpenDeleteDialog,
  mode,
  viewMode = "grid",
}: ExplorerFileListProps) {
  const { t, locale } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

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
                canDelete={canDelete}
                isPreviewOpen={item.id === selectedFileId}
                onPreview={onPreview}
                onDownload={onDownload}
                onOpenDeleteDialog={onOpenDeleteDialog}
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
                        canDelete={canDelete}
                        isPreviewOpen={item.id === selectedFileId}
                        onPreview={onPreview}
                        onDownload={onDownload}
                        onOpenDeleteDialog={onOpenDeleteDialog}
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
                        canDelete={canDelete}
                        isPreviewOpen={item.id === selectedFileId}
                        onPreview={onPreview}
                        onDownload={onDownload}
                        onOpenDeleteDialog={onOpenDeleteDialog}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
