"use client";

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

  return (
    <div className="group relative flex gap-3.5 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm transition-all duration-200 hover:border-border-strong hover:shadow-md">
      {/* Icon */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
        <Lightbulb className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {normalizeSkillName(skill.name)}
          </span>
          <Badge
            variant="secondary"
            className={cn("text-micro font-medium px-1.5 py-0", config.className)}
          >
            <Icon className="mr-1 h-2.5 w-2.5" />
            {t(labelKey)}
          </Badge>
        </div>
        {skill.description && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {skill.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground-dim">
          <span className="font-mono text-xs">{skill.name}</span>
        </div>
      </div>

      {/* Delete — only for user-installed skills */}
      {skill.source_type === "user" && onDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "absolute right-3 top-3 shrink-0 text-muted-foreground/0 transition-colors",
            "group-hover:text-muted-foreground group-focus-within:text-muted-foreground",
            "hover:text-destructive hover:bg-destructive/10",
          )}
          onClick={() => onDelete(skill.name)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
