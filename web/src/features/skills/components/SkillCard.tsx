"use client";

import { Trash2, Lightbulb } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { ToolingCard } from "@/shared/components/ToolingCard";
import { cn } from "@/shared/lib/utils";
import { ACTIVITY_META_BADGE_CLASSES } from "@/shared/lib/activity-meta-badge";
import {
  TOOLING_STATUS_TOGGLE_CLASSES,
  TOOLING_STATUS_TOGGLE_DISABLED_CLASSES,
  TOOLING_STATUS_TOGGLE_ENABLED_CLASSES,
} from "@/shared/lib/tooling-ui-styles";
import { useTranslation } from "@/i18n";
import { normalizeSkillName } from "../lib/normalize-skill-name";
import { SOURCE_STYLE, SOURCE_LABEL_KEY } from "../lib/skill-source-styles";
import type { Skill } from "../api/skills-api";

interface SkillCardProps {
  readonly skill: Skill;
  readonly onDelete?: (name: string) => void;
  readonly onToggle?: (name: string, enabled: boolean) => void;
}

const SOURCE_FOOTER_KEY: Record<Skill["source_type"], string> = {
  bundled: "skills.sectionBuiltIn",
  user: "skills.sectionInstalled",
  project: "skills.sectionInstalled",
};

export function SkillCard({ skill, onDelete, onToggle }: SkillCardProps) {
  const { t } = useTranslation();
  const config = SOURCE_STYLE[skill.source_type] ?? SOURCE_STYLE.bundled;
  const Icon = config.icon;
  const labelKey = SOURCE_LABEL_KEY[skill.source_type] ?? SOURCE_LABEL_KEY.bundled;
  const showDelete = skill.source_type !== "bundled" && onDelete;
  const isDisabled = skill.enabled === false;
  const displayName = normalizeSkillName(skill.name);
  const skillHref = `/skills/${encodeURIComponent(skill.name)}`;

  const badge = (
    <span
      className={cn(
        ACTIVITY_META_BADGE_CLASSES,
        "shrink-0 gap-1 transition-opacity duration-200",
        isDisabled && "opacity-60",
        config.className,
      )}
    >
      <Icon aria-hidden="true" className="h-2.5 w-2.5" />
      {t(labelKey)}
    </span>
  );

  const headerActions = showDelete ? (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`${t("skills.uninstall")} ${displayName}`}
      className="shrink-0 text-steel transition-[background-color,color] hover:bg-critical/10 hover:text-critical"
      onClick={(e) => {
        e.preventDefault();
        onDelete?.(skill.name);
      }}
    >
      <Trash2 aria-hidden="true" className="h-3 w-3" />
    </Button>
  ) : null;

  const footerRight = onToggle ? (
    <button
      type="button"
      role="switch"
      aria-checked={!isDisabled}
      aria-label={`${isDisabled ? t("skills.enable") : t("skills.disable")} ${displayName}`}
      className={cn(
        TOOLING_STATUS_TOGGLE_CLASSES,
        isDisabled
          ? TOOLING_STATUS_TOGGLE_DISABLED_CLASSES
          : TOOLING_STATUS_TOGGLE_ENABLED_CLASSES,
      )}
      onClick={(e) => {
        e.preventDefault();
        onToggle?.(skill.name, isDisabled);
      }}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full transition-colors duration-150",
          isDisabled ? "bg-border-strong" : "bg-accent-emerald",
        )}
      />
      {isDisabled ? t("skills.disabled") : t("skills.enabled")}
    </button>
  ) : null;

  return (
    <ToolingCard
      icon={
        <Lightbulb
          aria-hidden="true"
          className={cn("h-4 w-4", isDisabled ? "text-stone" : "text-steel")}
        />
      }
      badge={badge}
      headerActions={headerActions}
      title={displayName}
      body={
        skill.description ? (
          <p
            className={cn(
              "line-clamp-2 text-xs leading-relaxed",
              isDisabled ? "text-stone" : "text-steel",
            )}
          >
            {skill.description}
          </p>
        ) : null
      }
      footerLeft={
        <span className="label-mono truncate text-stone">
          {t(SOURCE_FOOTER_KEY[skill.source_type] ?? "skills.sectionInstalled")}
        </span>
      }
      footerRight={footerRight}
      href={skillHref}
      accessibleLabel={displayName}
      disabled={isDisabled}
    />
  );
}
