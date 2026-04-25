"use client";

import { useState, useEffect, useRef, useCallback, type ChangeEvent } from "react";
import { CircleHelp, Send } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { FOCUSABLE_SELECTOR } from "@/shared/lib/a11y";
import { useTranslation } from "@/i18n";

interface PromptOption {
  readonly id?: string;
  readonly label: string;
  readonly value?: string;
  readonly description?: string;
}

interface InputPromptProps {
  title?: string;
  question: string;
  options?: readonly PromptOption[];
  allowFreeform?: boolean;
  onSubmit: (response: string) => void;
}

export function InputPrompt({
  title,
  question,
  options = [],
  allowFreeform = true,
  onSubmit,
}: InputPromptProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!allowFreeform) return;
    inputRef.current?.focus();
  }, [allowFreeform]);

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
    <div className="fixed inset-0 z-50 flex items-end justify-center px-3 pb-3 sm:px-4 sm:pb-5">
      <div
        className="absolute inset-0 bg-overlay"
        aria-hidden="true"
      />

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="input-prompt-title"
        className="surface-overlay relative z-10 w-full max-w-2xl animate-modal-in overflow-hidden p-0"
      >
        <div className="border-l-2 border-l-border-active px-4 py-3.5 sm:px-5 sm:py-4">
          <div className="mb-2.5 flex items-center gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <CircleHelp className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3
                id="input-prompt-title"
                className="truncate text-sm font-semibold leading-5 text-foreground"
              >
                {title ?? t("inputPrompt.title")}
              </h3>
              <p className="text-xs leading-4 text-muted-foreground">
                {t("inputPrompt.subtitle")}
              </p>
            </div>
          </div>

          <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {question}
          </p>

          {options.length > 0 && (
            <div className="mb-3 grid gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
              {options.map((option, idx) => (
                <Button
                  key={option.id ?? option.value ?? option.label ?? idx}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-9 items-start justify-start whitespace-normal rounded-md px-3 py-2 text-left"
                  onClick={() => onSubmit(option.value ?? option.label)}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium leading-5 text-foreground">
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="text-xs leading-4 text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                </Button>
              ))}
            </div>
          )}

          {allowFreeform && (
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
                placeholder={t("inputPrompt.placeholder")}
                aria-label={t("inputPrompt.ariaLabel")}
                className="h-9 flex-1 px-3"
              />
              <Button
                type="submit"
                disabled={!value.trim()}
                size="icon"
                className="size-9 rounded-md"
                aria-label={t("inputPrompt.send")}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
