"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Lightbulb } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { normalizeSkillName } from "../lib/normalize-skill-name";
import { SOURCE_STYLE, SOURCE_LABEL_KEY } from "../lib/skill-source-styles";
import type { Skill } from "../api/skills-api";

interface SkillCardProps {
  readonly skill: Skill;
  readonly onDelete?: (name: string) => void;
  readonly onToggle?: (name: string, enabled: boolean) => void;
}

export function SkillCard({ skill, onDelete, onToggle }: SkillCardProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const config = SOURCE_STYLE[skill.source_type] ?? SOURCE_STYLE.bundled;
  const Icon = config.icon;
  const labelKey = SOURCE_LABEL_KEY[skill.source_type] ?? SOURCE_LABEL_KEY.bundled;
  const showDelete = skill.source_type !== "bundled" && onDelete;
  const isDisabled = skill.enabled === false;
  const skillHref = `/skills/${encodeURIComponent(skill.name)}`;

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={normalizeSkillName(skill.name)}
      className={cn(
        "group flex h-full cursor-pointer flex-col surface-panel p-4 transition-[border-color,background-color] duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isDisabled
          ? "border-border hover:border-border"
          : "border-border hover:border-border-strong hover:bg-muted/40",
      )}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('[data-skill-interactive="true"]')) {
          return;
        }
        router.push(skillHref);
      }}
      onKeyDown={(event) => {
        const isActivationKey = event.key === "Enter" || event.key === " ";
        if (!isActivationKey) {
          return;
        }
        event.preventDefault();
        router.push(skillHref);
      }}
    >
      {/* Top row: icon + badge + optional delete */}
      <div className="flex items-start justify-between gap-2">
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
          isDisabled ? "bg-secondary" : "bg-secondary group-hover:bg-muted",
        )}>
          <Lightbulb aria-hidden="true" className={cn(
            "h-4 w-4 transition-colors duration-200",
            isDisabled ? "text-muted-foreground-dim" : "text-muted-foreground",
          )} />
        </div>
        <div className="flex items-center gap-1.5">
          <Badge
            variant="secondary"
            className={cn(
              "font-mono text-micro font-medium px-1.5 py-0 shrink-0 transition-opacity duration-200",
              isDisabled && "opacity-60",
              config.className,
            )}
          >
            <Icon aria-hidden="true" className="mr-1 h-2.5 w-2.5" />
            {t(labelKey)}
          </Badge>
          {showDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              data-skill-interactive="true"
              aria-label={`${t("skills.uninstall")} ${normalizeSkillName(skill.name)}`}
              className={cn(
                "shrink-0 text-transparent transition-colors",
                "group-hover:text-muted-foreground group-focus-within:text-muted-foreground",
                "hover:text-destructive hover:bg-destructive/10",
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete?.(skill.name);
              }}
            >
              <Trash2 aria-hidden="true" className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Name */}
      <h3 className={cn(
        "mt-3 text-sm font-semibold leading-snug transition-colors duration-200",
        isDisabled ? "text-muted-foreground" : "text-foreground",
      )}>
        {normalizeSkillName(skill.name)}
      </h3>

      {/* Description */}
      <div className="mt-1.5 min-h-[2.5rem]">
        {skill.description && (
          <p className={cn(
            "line-clamp-2 text-xs leading-relaxed transition-colors duration-200",
            isDisabled ? "text-muted-foreground-dim" : "text-muted-foreground",
          )}>
            {skill.description}
          </p>
        )}
      </div>

      {/* Footer: slug + status toggle */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span className="font-mono text-micro text-muted-foreground-dim truncate">
          {skill.name}
        </span>
        {onToggle && (
          <button
            type="button"
            data-skill-interactive="true"
            role="switch"
            aria-checked={!isDisabled}
            aria-label={isDisabled ? t("skills.enable") : t("skills.disable")}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isDisabled
                ? "bg-secondary text-muted-foreground-dim hover:bg-secondary hover:text-muted-foreground"
                : "border border-border bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle?.(skill.name, isDisabled);
            }}
          >
            <span className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors duration-150",
              isDisabled ? "bg-border-strong" : "bg-foreground",
            )} />
            {isDisabled ? t("skills.disabled") : t("skills.enabled")}
          </button>
        )}
      </div>
      <Link
        href={skillHref}
        data-skill-interactive="true"
        className="sr-only"
        tabIndex={-1}
      >
        {normalizeSkillName(skill.name)}
      </Link>
    </div>
  );
}
