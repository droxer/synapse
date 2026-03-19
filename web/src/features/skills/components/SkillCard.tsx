"use client";

import Link from "next/link";
import { Trash2, Package, FolderGit2, Globe, Lightbulb } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { normalizeSkillName } from "../lib/normalize-skill-name";
import type { Skill } from "../api/skills-api";

const sourceStyle = {
  bundled: { icon: Package, className: "bg-secondary text-muted-foreground" },
  user: { icon: Globe, className: "bg-accent-emerald/10 text-accent-emerald" },
  project: { icon: FolderGit2, className: "bg-accent-purple/10 text-accent-purple" },
} as const;

const SOURCE_LABEL_KEY: Record<string, string> = {
  bundled: "skills.source.bundled",
  user: "skills.source.user",
  project: "skills.source.project",
};

interface SkillCardProps {
  readonly skill: Skill;
  readonly onDelete?: (name: string) => void;
}

export function SkillCard({ skill, onDelete }: SkillCardProps) {
  const { t } = useTranslation();
  const config = sourceStyle[skill.source_type] ?? sourceStyle.bundled;
  const Icon = config.icon;
  const labelKey = SOURCE_LABEL_KEY[skill.source_type] ?? SOURCE_LABEL_KEY.bundled;
  const showDelete = skill.source_type === "user" && onDelete;

  return (
    <Link
      href={`/skills/${encodeURIComponent(skill.name)}`}
      className="group flex h-full cursor-pointer flex-col rounded-lg border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:border-border-strong hover:shadow-md"
    >
      {/* Top row: icon + badge + optional delete */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <Lightbulb className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-1.5">
          <Badge
            variant="secondary"
            className={cn("text-micro font-medium px-1.5 py-0 shrink-0", config.className)}
          >
            <Icon className="mr-1 h-2.5 w-2.5" />
            {t(labelKey)}
          </Badge>
          {showDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${t("skills.uninstall")} ${normalizeSkillName(skill.name)}`}
              className={cn(
                "shrink-0 text-muted-foreground/0 transition-colors",
                "group-hover:text-muted-foreground group-focus-within:text-muted-foreground",
                "hover:text-destructive hover:bg-destructive/10",
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(skill.name);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Name */}
      <h3 className="mt-3 text-sm font-semibold leading-snug text-foreground">
        {normalizeSkillName(skill.name)}
      </h3>

      {/* Description — clamp to 2 lines, min-h for uniform grid cells */}
      <div className="mt-1.5 min-h-[2.5rem]">
        {skill.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {skill.description}
          </p>
        )}
      </div>

      {/* Slug / identifier — pushed to bottom */}
      <div className="mt-auto pt-3">
        <span className="font-mono text-micro text-muted-foreground-dim">
          {skill.name}
        </span>
      </div>
    </Link>
  );
}
