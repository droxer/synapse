"use client";

import { useState } from "react";
import { Lightbulb, X, Search, Check } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { useSkillsCache } from "../hooks/use-skills-cache";
import { normalizeSkillName } from "../lib/normalize-skill-name";

interface SkillSelectorProps {
  readonly selectedSkill: string | null;
  readonly onSelect: (skillName: string | null) => void;
  /** Display variant */
  readonly variant?: "default" | "welcome" | "shelf";
  /** @deprecated Use variant instead */
  readonly buttonSize?: "icon-xs" | "icon-sm";
}

export function SkillSelector({
  selectedSkill,
  onSelect,
  variant = "default",
  buttonSize,
}: SkillSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const { getAllSkills } = useSkillsCache();
  const skills = getAllSkills();

  const filtered = filter
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.description?.toLowerCase().includes(filter.toLowerCase()),
      )
    : skills;

  const handleSelect = (name: string) => {
    if (selectedSkill === name) {
      onSelect(null);
    } else {
      onSelect(name);
    }
    setOpen(false);
    setFilter("");
  };

  return (
    <>
      {/* Trigger button + popover */}
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setFilter(""); }}>
        {selectedSkill && variant !== "shelf" ? (
          /* Active skill pill — morphs in-place to show selection */
          <div className={cn(
            "group flex items-center gap-1 rounded-lg border transition-colors",
            "border-accent-purple/20 bg-accent-purple/10 text-accent-purple",
            "hover:bg-accent-purple/15",
            variant === "welcome" ? "h-8 pl-2.5 pr-1" : "h-7 pl-2 pr-0.5",
          )}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 text-xs font-medium outline-none",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded",
                )}
              >
                <Lightbulb className="h-3.5 w-3.5" />
                <span className="hidden sm:inline max-w-[10rem] truncate">
                  {normalizeSkillName(selectedSkill)}
                </span>
              </button>
            </PopoverTrigger>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSelect(null); }}
              aria-label={t("skills.selector.remove", { name: normalizeSkillName(selectedSkill) })}
              className={cn(
                "flex items-center justify-center rounded-md transition-colors",
                "text-accent-purple/60 hover:text-accent-purple hover:bg-accent-purple/15",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                variant === "welcome" ? "h-6 w-6" : "h-5 w-5",
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          /* Inactive trigger — plain pill or shelf icon */
          <PopoverTrigger asChild>
            {variant === "shelf" || buttonSize ? (
              <Button
                type="button"
                variant="ghost"
                size={buttonSize ?? "icon-xs"}
                aria-label={t("skills.selector.select")}
                className={cn(
                  "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  variant === "shelf" && "h-6 w-6",
                  selectedSkill && "text-accent-purple",
                )}
              >
                <Lightbulb className={variant === "shelf" ? "h-3 w-3" : "h-4 w-4"} />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("skills.selector.select")}
                className={cn(
                  "gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground",
                  variant === "welcome" ? "h-8 px-3 bg-secondary/50" : "h-7 bg-secondary/40",
                )}
              >
                <Lightbulb className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("chat.skillLabel")}</span>
              </Button>
            )}
          </PopoverTrigger>
        )}
        <PopoverContent
          side="top"
          align="start"
          className="w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover p-0"
          style={{ boxShadow: "var(--shadow-elevated)" }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Lightbulb className="h-3.5 w-3.5 text-accent-purple" />
            <span className="text-xs font-semibold tracking-wide text-foreground">
              {t("skills.selector.title")}
            </span>
          </div>

          {/* Search filter */}
          {skills.length > 4 && (
            <div className="border-b border-border px-3 py-2">
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("skills.selector.search")}
                  className="flex-1 bg-transparent text-xs text-foreground placeholder:text-placeholder outline-none"
                />
              </div>
            </div>
          )}

          {/* Skill list */}
          <div className="max-h-64 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {skills.length === 0
                  ? t("skills.selector.noSkills")
                  : t("skills.selector.noMatching")}
              </div>
            ) : (
              filtered.map((skill) => {
                const isSelected = selectedSkill === skill.name;
                return (
                  <button
                    key={skill.name}
                    type="button"
                    onClick={() => handleSelect(skill.name)}
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                      "hover:bg-secondary/60",
                      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      isSelected && "bg-accent-purple/10",
                    )}
                  >
                    {/* Skill icon */}
                    <div
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                        isSelected
                          ? "bg-accent-purple/15 text-accent-purple"
                          : "bg-secondary/80 text-muted-foreground group-hover:bg-secondary group-hover:text-foreground",
                      )}
                    >
                      <Lightbulb className="h-3.5 w-3.5" />
                    </div>

                    {/* Skill info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-sm font-medium",
                          isSelected ? "text-accent-purple" : "text-foreground",
                        )}>
                          {normalizeSkillName(skill.name)}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-micro font-medium",
                            skill.source_type === "bundled" &&
                              "bg-secondary text-muted-foreground",
                            skill.source_type === "user" &&
                              "bg-accent-emerald/10 text-accent-emerald",
                            skill.source_type === "project" &&
                              "bg-accent-purple/10 text-accent-purple",
                          )}
                        >
                          {skill.source_type === "bundled"
                            ? t("skills.source.bundled")
                            : skill.source_type === "user"
                              ? t("skills.source.user")
                              : t("skills.source.project")}
                        </span>
                      </div>
                      {skill.description && (
                        <div className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">
                          {skill.description}
                        </div>
                      )}
                    </div>

                    {/* Selected checkmark */}
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                      {isSelected && (
                        <Check className="h-4 w-4 text-accent-purple" strokeWidth={2.5} />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
