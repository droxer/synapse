"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import { FOCUSABLE_SELECTOR } from "@/shared/lib/a11y";
import { useAppStore } from "@/shared/stores";
import { useTranslation } from "@/i18n";
import {
  Search,
  Plus,
  Sparkles,
  Globe,
  Presentation,
  AppWindow,
  Palette,
  Lightbulb,
  Blocks,
  MessageSquare,
} from "lucide-react";

interface CommandPaletteProps {
  readonly onNewTask: (prompt: string) => void;
  readonly onNavigateHome?: () => void;
  readonly onNavigateSkills?: () => void;
  readonly onNavigateMcp?: () => void;
  readonly onOpenConversation?: (conversationId: string) => void;
}

const QUICK_ACTION_KEYS = [
  { icon: Sparkles, labelKey: "command.summarizePage", promptKey: "command.summarizePrompt" },
  { icon: Presentation, labelKey: "command.createSlides", promptKey: "command.createSlidesPrompt" },
  { icon: Globe, labelKey: "command.buildWebsite", promptKey: "command.buildWebsitePrompt" },
  { icon: AppWindow, labelKey: "command.developApp", promptKey: "command.developAppPrompt" },
  { icon: Palette, labelKey: "command.designUI", promptKey: "command.designUIPrompt" },
] as const;

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-sm text-foreground transition-colors data-[selected=true]:border-border data-[selected=true]:bg-secondary data-[selected=true]:text-foreground";

const GROUP_HEADING_CLASS =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:label-mono [&_[cmdk-group-heading]]:text-muted-foreground";

function ShortcutHint({ keys }: { readonly keys: string }) {
  return (
    <kbd className="ml-auto shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
      {keys}
    </kbd>
  );
}

export function CommandPalette({
  onNewTask,
  onNavigateHome,
  onNavigateSkills,
  onNavigateMcp,
  onOpenConversation,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const conversationHistory = useAppStore((s) => s.conversationHistory);

  const recentConversations = conversationHistory.slice(0, 5);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }, []);

  // Global Cmd+N / Ctrl+N shortcut for new task
  const handleGlobalShortcuts = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault();
      onNavigateHome?.();
    }
  }, [onNavigateHome]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keydown", handleGlobalShortcuts);
    const handleOpenEvent = () => setOpen(true);
    document.addEventListener("synapse:open-command-palette", handleOpenEvent);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keydown", handleGlobalShortcuts);
      document.removeEventListener("synapse:open-command-palette", handleOpenEvent);
    };
  }, [handleKeyDown, handleGlobalShortcuts]);

  // Focus trap: keep Tab cycling within the dialog when open
  useEffect(() => {
    if (!open) return;

    const handleTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const container = dialogRef.current;
      if (!container) return;

      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleTrap);
    return () => document.removeEventListener("keydown", handleTrap);
  }, [open]);

  const handleSelect = (prompt: string) => {
    setOpen(false);
    onNewTask(prompt);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
          />

          {/* Command dialog */}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("command.ariaLabel")}
            className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] sm:pt-[20vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            <Command
              className="surface-overlay w-[calc(100%-1.5rem)] max-w-[40rem] overflow-hidden p-0"
              loop
            >
              {/* Search input */}
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <Command.Input
                  placeholder={t("command.placeholder")}
                  className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-placeholder outline-none focus-visible:outline-none"
                  aria-label={t("command.placeholder")}
                  autoFocus
                />
                <kbd className="shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                  {t("command.escapeKey")}
                </kbd>
              </div>

              <Command.List className="max-h-[320px] overflow-y-auto overscroll-contain p-2">
                <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("command.noResults")}
                </Command.Empty>

                {/* Quick Actions */}
                <Command.Group heading={t("command.quickActions")} className={GROUP_HEADING_CLASS}>
                  {QUICK_ACTION_KEYS.map((action) => {
                    const label = t(action.labelKey);
                    const prompt = t(action.promptKey);
                    return (
                      <Command.Item
                        key={action.labelKey}
                        value={label}
                        onSelect={() => handleSelect(prompt)}
                        className={ITEM_CLASS}
                      >
                        <action.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {label}
                      </Command.Item>
                    );
                  })}
                </Command.Group>

                {/* Navigation */}
                <Command.Group heading={t("command.navigation")} className={GROUP_HEADING_CLASS}>
                  <Command.Item
                    value={t("command.skills")}
                    onSelect={() => {
                      setOpen(false);
                      onNavigateSkills?.();
                    }}
                    className={ITEM_CLASS}
                  >
                    <Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {t("command.skills")}
                  </Command.Item>
                  <Command.Item
                    value={t("command.mcp")}
                    onSelect={() => {
                      setOpen(false);
                      onNavigateMcp?.();
                    }}
                    className={ITEM_CLASS}
                  >
                    <Blocks className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {t("command.mcp")}
                  </Command.Item>
                  <Command.Item
                    value={t("command.newTask")}
                    onSelect={() => {
                      setOpen(false);
                      onNavigateHome?.();
                    }}
                    className={ITEM_CLASS}
                  >
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {t("command.newTask")}
                    <ShortcutHint keys="⌘N" />
                  </Command.Item>
                </Command.Group>

                {/* Recent Conversations */}
                {recentConversations.length > 0 && (
                  <Command.Group heading={t("command.recentConversations")} className={GROUP_HEADING_CLASS}>
                    {recentConversations.map((conversation) => (
                      <Command.Item
                        key={conversation.id}
                        value={`${t("command.recentPrefix")} ${conversation.title}`}
                        onSelect={() => {
                          setOpen(false);
                          onOpenConversation?.(conversation.id);
                        }}
                        className={ITEM_CLASS}
                      >
                        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{conversation.title}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>

              {/* Footer hint */}
              <div className="flex items-center justify-between bg-muted/30 px-4 py-2">
                <span className="text-xs text-muted-foreground">
                  {t("command.navigateHint")} <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-micro text-muted-foreground">↑↓</kbd> · {t("command.selectHint")} <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-micro text-muted-foreground">↵</kbd>
                </span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
