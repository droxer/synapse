"use client";

import { useState, useEffect, useRef, useCallback, type ChangeEvent } from "react";
import { MessageCircle, Send } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
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
        className="relative z-10 mx-4 w-full max-w-xl animate-modal-in"
      >
        <div className="surface-overlay p-5 sm:p-6">
          {/* Header */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div>
              <h3 id="input-prompt-title" className="text-base font-semibold text-foreground">
                {t("inputPrompt.title")}
              </h3>
              <p className="text-xs text-muted-foreground">{t("inputPrompt.subtitle")}</p>
            </div>
          </div>

          {/* Question */}
          <div className="mb-4 rounded-lg border border-border bg-secondary p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {question}
            </p>
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex gap-3">
            <Input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
              placeholder={t("inputPrompt.placeholder")}
              aria-label={t("inputPrompt.ariaLabel")}
              className="h-10 flex-1 px-4"
            />
            <Button
              type="submit"
              disabled={!value.trim()}
              className="h-10 gap-2 rounded-lg"
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
