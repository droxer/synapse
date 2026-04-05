"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, Send } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { FOCUSABLE_SELECTOR } from "@/shared/lib/a11y";
import { useTranslation } from "@/i18n";

interface InputPromptProps {
  question: string;
  onSubmit: (response: string) => void;
}

export function InputPrompt({ question, onSubmit }: InputPromptProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Focus trap
  useEffect(() => {
    const container = modalRef.current;
    if (!container) return;

    const handleTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

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
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  }, [value, onSubmit]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm" aria-hidden="true" />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="input-prompt-title"
        className="relative z-10 mx-4 w-full max-w-lg animate-modal-in"
      >
        <div className="rounded-lg border border-border bg-card p-6 shadow-elevated">
          {/* Header */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div>
              <h3 id="input-prompt-title" className="text-base font-semibold text-foreground">
                {t("inputPrompt.title")}
              </h3>
              <p className="text-caption text-muted-foreground">{t("inputPrompt.subtitle")}</p>
            </div>
          </div>

          {/* Question */}
          <div className="mb-5 rounded-md border border-border bg-muted p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {question}
            </p>
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("inputPrompt.placeholder")}
              aria-label={t("inputPrompt.ariaLabel")}
              className="flex-1 rounded-md border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-placeholder outline-none transition-[color,background-color,border-color,box-shadow] duration-200 ease-out focus-visible:border-border-active focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <Button
              type="submit"
              disabled={!value.trim()}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {t("inputPrompt.send")}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
