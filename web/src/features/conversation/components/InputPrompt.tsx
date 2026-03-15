"use client";

import { useState, useEffect, useRef } from "react";
import { MessageCircle, Send } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

interface InputPromptProps {
  question: string;
  onSubmit: (response: string) => void;
}

export function InputPrompt({ question, onSubmit }: InputPromptProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative z-10 mx-4 w-full max-w-lg animate-slide-up">
        <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-elevated)" }}>
          {/* Header */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Agent needs your input
              </h3>
              <p className="text-caption text-muted-foreground">Please respond to continue</p>
            </div>
          </div>

          {/* Question */}
          <div className="mb-5 rounded-lg border border-border bg-muted p-4">
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
              placeholder="Type your response..."
              className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-placeholder outline-none transition-all duration-200 focus:border-border-active focus:ring-2 focus:ring-ring/10"
            />
            <Button
              type="submit"
              disabled={!value.trim()}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              Send
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
