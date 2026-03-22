"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { LibraryArtifactCard } from "./LibraryArtifactCard";
import type { LibraryGroup, ViewMode } from "../types";

interface ConversationGroupProps {
  readonly group: LibraryGroup;
  readonly viewMode: ViewMode;
}

export function ConversationGroup({ group, viewMode }: ConversationGroupProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const title = group.title || t("library.untitledTask");
  const date = new Date(group.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
          "transition-colors duration-150 hover:bg-secondary",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 truncate text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{date}</span>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {t("library.artifactCount", { count: group.artifacts.length })}
        </span>
      </button>

      {expanded && (
        <div
          className={cn(
            "ml-3 sm:ml-6",
            viewMode === "grid"
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              : "space-y-1.5",
          )}
        >
          {group.artifacts.map((artifact) => (
            <LibraryArtifactCard
              key={artifact.id}
              artifact={artifact}
              conversationId={group.conversation_id}
              viewMode={viewMode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
