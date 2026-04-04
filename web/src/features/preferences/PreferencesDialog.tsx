"use client";

import { useState } from "react";
import { Zap, Sun, Globe, Brain, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
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
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden p-0">
        {/* Screen-reader-only title */}
        <DialogTitle className="sr-only">{t("preferences.title")}</DialogTitle>

        <div className="flex h-[min(80vh,700px)]">
          {/* Side menu */}
          <nav
            className="flex w-64 shrink-0 flex-col border-r border-border bg-secondary p-3"
            aria-label={t("preferences.title")}
          >
            <p className="px-3 pb-3 pt-4 text-micro font-semibold uppercase tracking-widest text-muted-foreground-dim">
              {t("preferences.title")}
            </p>
            {MENU_ITEMS.map(({ id, labelKey, icon: Icon }) => {
              const isActive = id === activeId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveId(id)}
                  className={cn(
                    "relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-[color,background-color] duration-150 ease-out overflow-hidden mb-1",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    isActive
                      ? "bg-accent-purple/10 text-accent-purple font-semibold"
                      : "text-muted-foreground hover:bg-background hover:text-foreground",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  {isActive && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent-purple rounded-r-full" />
                  )}
                  <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-accent-purple" : "text-muted-foreground")} />
                  {t(labelKey)}
                </button>
              );
            })}
          </nav>

          {/* Content panel */}
          <div className="flex-1 overflow-y-auto p-8">
            <ActivePanel />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
