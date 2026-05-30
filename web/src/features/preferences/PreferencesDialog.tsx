"use client";

import { useState } from "react";
import { Zap, Sun, Globe, Brain, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { cn } from "@/shared/lib/utils";
import { TokenUsageTab } from "./components/TokenUsageTab";
import { ThemeTab } from "./components/ThemeTab";
import { LanguageTab } from "./components/LanguageTab";
import { MemoryTab } from "./components/MemoryTab";

interface PreferencesDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface MenuItem {
  readonly id: string;
  readonly labelKey: string;
  readonly icon: LucideIcon;
}

const MENU_ITEMS: readonly MenuItem[] = [
  { id: "theme", labelKey: "preferences.tabs.theme", icon: Sun },
  { id: "language", labelKey: "preferences.tabs.language", icon: Globe },
  { id: "usage", labelKey: "preferences.tabs.tokenUsage", icon: Zap },
  { id: "memory", labelKey: "preferences.tabs.memory", icon: Brain },
];

const PANELS: Record<string, () => React.JSX.Element> = {
  theme: ThemeTab,
  language: LanguageTab,
  usage: TokenUsageTab,
  memory: MemoryTab,
};

export function PreferencesDialog({ open, onOpenChange }: PreferencesDialogProps) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState("theme");

  const ActivePanel = PANELS[activeId];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,60rem)] max-w-[min(96vw,60rem)] sm:max-w-[min(96vw,60rem)] max-h-[min(92vh,calc(100dvh-2rem))] overflow-hidden p-0 gap-0">
        <DialogTitle className="sr-only">{t("preferences.title")}</DialogTitle>

        <div className="flex h-[min(86vh,48rem)] min-h-[28rem] w-full min-w-0 flex-col md:flex-row">
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline-soft/60 bg-surface-soft p-2 md:w-56 md:flex-col md:gap-0.5 md:overflow-x-visible md:border-b-0 md:border-r md:p-3"
            aria-label={t("preferences.title")}
          >
            <p className="label-mono hidden px-3 pb-3 pt-3 text-stone md:block">
              {t("preferences.title")}
            </p>
            {MENU_ITEMS.map(({ id, labelKey, icon: Icon }) => {
              const isActive = id === activeId;
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setActiveId(id)}
                  className={cn(
                    "group relative flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-body-sm transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
                    isActive
                      ? "bg-canvas text-ink-deep md:font-medium"
                      : "text-steel hover:bg-canvas/60 hover:text-ink-deep",
                  )}
                >
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cobalt md:inset-y-1.5 md:left-0 md:right-auto md:h-auto md:w-0.5"
                    />
                  ) : null}
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors duration-150",
                      isActive ? "text-cobalt" : "text-stone group-hover:text-steel",
                    )}
                  />
                  <span className="whitespace-nowrap">{t(labelKey)}</span>
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
            <ActivePanel />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
