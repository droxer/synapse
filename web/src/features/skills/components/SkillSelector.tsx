"use client";

import { useState, type ChangeEvent } from "react";
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
}

export function SkillSelector({
  selectedSkill,
  onSelect,
  variant = "default",
}: SkillSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const { getAllSkills } = useSkillsCache();
  const skills = getAllSkills().filter((s) => s.enabled !== false);

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
            "border-border bg-muted text-foreground",
            "hover:border-border-strong",
            variant === "welcome" ? "h-8 pl-2.5 pr-1" : "h-7 pl-2 pr-0.5",
          )}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`${t("skills.selector.select")}: ${normalizeSkillName(selectedSkill)}`}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 text-xs font-medium outline-none",
                  "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded",
                )}
              >
                <Lightbulb aria-hidden="true" className="h-3.5 w-3.5" />
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
                "text-muted-foreground hover:text-foreground hover:bg-secondary",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                variant === "welcome" ? "h-6 w-6" : "h-5 w-5",
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          /* Inactive trigger — plain pill or shelf icon */
          <PopoverTrigger asChild>
            {variant === "shelf" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("skills.selector.select")}
                className={cn(
                  "h-6 w-6 text-muted-foreground hover:bg-secondary hover:text-foreground",
                  selectedSkill && "text-foreground",
                )}
              >
                <Lightbulb aria-hidden="true" className="h-3 w-3" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("skills.selector.select")}
                className={cn(
                  "gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground",
                  variant === "welcome" ? "h-8 px-3 bg-muted" : "h-7 bg-muted",
                )}
              >
                <Lightbulb aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("chat.skillLabel")}</span>
              </Button>
            )}
          </PopoverTrigger>
        )}
        <PopoverContent
          side="top"
          align="start"
          className="w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover p-0"
        >
          {/* Search filter */}
          {skills.length > 4 && (
            <div className="border-b border-border px-3 py-2">
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
                <Search aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
                  placeholder={t("skills.selector.search")}
                  aria-label={t("skills.selector.search")}
                  className="flex-1 bg-transparent text-xs text-foreground placeholder:text-placeholder outline-none"
                />
              </div>
            </div>
          )}

          {/* Skill grid */}
          <div className="max-h-60 sm:max-h-72 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {skills.length === 0
                  ? t("skills.selector.noSkills")
                  : t("skills.selector.noMatching")}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {filtered.map((skill) => {
                  const isSelected = selectedSkill === skill.name;
                  return (
                    <button
                      key={skill.name}
                      type="button"
                      onClick={() => handleSelect(skill.name)}
                      className={cn(
                        "group relative flex cursor-pointer flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors",
                        "hover:bg-muted",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        isSelected && "bg-muted ring-1 ring-border-strong",
                      )}
                    >
                      {/* Selected indicator */}
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5">
                          <Check aria-hidden="true" className="h-3.5 w-3.5 text-foreground" strokeWidth={2.5} />
                        </div>
                      )}

                      {/* Skill name + source badge */}
                      <div className="flex items-center gap-1.5 pr-4">
                        <div
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
                            isSelected
                              ? "bg-muted text-foreground"
                              : "bg-muted text-muted-foreground group-hover:text-foreground",
                          )}
                        >
                          <Lightbulb aria-hidden="true" className="h-3 w-3" />
                        </div>
                        <span className="truncate text-xs font-medium text-foreground">
                          {normalizeSkillName(skill.name)}
                        </span>
                      </div>

                      {/* Description */}
                      {skill.description && (
                        <div className="line-clamp-2 pl-7 text-xs leading-snug text-muted-foreground">
                          {skill.description}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
