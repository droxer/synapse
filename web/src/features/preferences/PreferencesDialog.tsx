"use client";

import { useState } from "react";
import { Zap, Sun, Globe, Brain, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { SegmentedControl } from "@/shared/components/SegmentedControl";
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
      <DialogContent className="w-[min(96vw,80rem)] max-w-[min(96vw,80rem)] sm:max-w-[min(96vw,80rem)] max-h-[min(92vh,calc(100dvh-2rem))] overflow-hidden p-0 gap-0">
        {/* Screen-reader-only title */}
        <DialogTitle className="sr-only">{t("preferences.title")}</DialogTitle>

        <div className="flex h-[min(90vh,56rem)] min-h-[28rem] w-full min-w-0 flex-col md:flex-row">
          {/* Side menu */}
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-secondary p-2 md:w-72 md:flex-col md:overflow-x-visible md:border-b-0 md:p-3"
            aria-label={t("preferences.title")}
          >
            <p className="label-mono hidden px-3 pb-3 pt-4 text-muted-foreground-dim md:block">
              {t("preferences.title")}
            </p>
            <SegmentedControl
              ariaLabel={t("preferences.title")}
              value={activeId}
              onValueChange={setActiveId}
              className="w-full min-w-max border-0 bg-transparent p-0 md:min-w-0 md:flex-col md:items-stretch"
              optionClassName="shrink-0 justify-start md:w-full md:justify-start"
              selectedOptionClassName="bg-background text-foreground"
              inactiveOptionClassName="hover:bg-background"
              options={MENU_ITEMS.map(({ id, labelKey, icon: Icon }) => ({
                value: id,
                label: t(labelKey),
                icon: <Icon className="h-4 w-4" />,
              }))}
            />
          </nav>

          {/* Content panel */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
            <ActivePanel />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
