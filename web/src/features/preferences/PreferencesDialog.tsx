"use client";

import { useState } from "react";
import { Zap, Sun, Globe, type LucideIcon } from "lucide-react";
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
];

const PANELS: Record<string, () => React.JSX.Element> = {
  theme: ThemeTab,
  language: LanguageTab,
  usage: TokenUsageTab,
};

export function PreferencesDialog({ open, onOpenChange }: PreferencesDialogProps) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState("theme");

  const ActivePanel = PANELS[activeId];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-hidden p-0">
        {/* Screen-reader-only title */}
        <DialogTitle className="sr-only">{t("preferences.title")}</DialogTitle>

        <div className="flex h-[min(70vh,560px)]">
          {/* Side menu */}
          <nav
            className="flex w-48 shrink-0 flex-col border-r border-border bg-secondary/30 p-2"
            aria-label={t("preferences.title")}
          >
            <p className="px-2.5 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-100",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    isActive
                      ? "bg-background text-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {t(labelKey)}
                </button>
              );
            })}
          </nav>

          {/* Content panel */}
          <div className="flex-1 overflow-y-auto p-6">
            <ActivePanel />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
