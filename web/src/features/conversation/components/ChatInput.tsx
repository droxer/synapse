"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface ChatInputProps {
  readonly onSendMessage: (message: string) => void;
}

export function ChatInput({ onSendMessage }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resetHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    resetHeight();
  }, [input, resetHeight]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const hasContent = input.trim().length > 0;

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      <form onSubmit={handleSubmit}>
        <div
          className={cn(
            "relative rounded-xl bg-card transition-shadow duration-200",
            isFocused
              ? "shadow-[0_0_0_1px_var(--color-border-active),0_4px_12px_rgba(28,25,23,0.06)]"
              : "shadow-[0_0_0_1px_var(--color-border),0_1px_3px_rgba(28,25,23,0.04)]",
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Send a message..."
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-10 text-sm leading-relaxed text-foreground placeholder:text-placeholder outline-none"
          />

          {/* Bottom bar: hint + send */}
          <div className="absolute right-3 bottom-2.5 left-3 flex items-center justify-between">
            <span
              className={cn(
                "text-[11px] text-placeholder select-none transition-opacity duration-150",
                hasContent ? "opacity-100" : "opacity-0",
              )}
            >
              <kbd className="font-sans">Enter</kbd> to send
              <span className="mx-1 text-border-strong">&middot;</span>
              <kbd className="font-sans">Shift + Enter</kbd> for new line
            </span>

            <button
              type="submit"
              disabled={!hasContent}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-150",
                hasContent
                  ? "bg-foreground text-background hover:opacity-80 active:scale-95"
                  : "bg-transparent text-placeholder cursor-default",
              )}
            >
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
