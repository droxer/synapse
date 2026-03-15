"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUp,
  Presentation,
  Globe,
  AppWindow,
  Palette,
  MoreHorizontal,
  Plus,
  Paperclip,
  Sparkles,
} from "lucide-react";
import { IconButton } from "@/shared/components";

interface WelcomeScreenProps {
  onSubmitTask: (task: string) => void;
}

const QUICK_ACTIONS = [
  { icon: Presentation, label: "Create slides", prompt: "Create a presentation about " },
  { icon: Globe, label: "Build website", prompt: "Build a website that " },
  { icon: AppWindow, label: "Develop apps", prompt: "Develop an app that " },
  { icon: Palette, label: "Design", prompt: "Design a " },
  { icon: MoreHorizontal, label: "More", prompt: "" },
] as const;

const pillContainer = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.3,
    },
  },
};

const pillItem = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" as const },
  },
};

export function WelcomeScreen({ onSubmitTask }: WelcomeScreenProps) {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSubmitTask(trimmed);
    setInput("");
  };

  const handleQuickAction = (prompt: string) => {
    if (prompt) {
      setInput(prompt);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-6">
      {/* Subtle radial glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 45%, rgba(214, 211, 209, 0.3) 0%, transparent 70%)",
        }}
      />

      <motion.div
        className="relative z-10 flex w-full max-w-[680px] flex-col items-center"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const }}
      >
        {/* Large serif heading — matching Manus scale */}
        <h1 className="mb-10 text-center font-serif text-[2.75rem] leading-[1.15] font-normal tracking-tight text-foreground sm:text-[3.25rem]">
          What can I do for you?
        </h1>

        {/* Input card */}
        <form onSubmit={handleSubmit} className="mb-6 w-full">
          <div
            className="rounded-2xl border bg-card transition-all duration-200"
            style={{
              borderColor: isFocused
                ? "var(--color-border-active)"
                : "var(--color-border)",
              boxShadow: isFocused
                ? "var(--shadow-card-hover)"
                : "var(--shadow-card)",
            }}
          >
            {/* Textarea */}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Assign a task or ask anything"
              rows={3}
              className="w-full resize-none rounded-t-2xl bg-transparent px-5 pt-4 pb-2 text-[0.9375rem] leading-relaxed text-foreground placeholder:text-placeholder outline-none"
              autoFocus
            />

            {/* Bottom toolbar — left icons + right send */}
            <div className="flex items-center justify-between px-3 pb-3">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-secondary hover:text-muted-foreground"
                >
                  <Plus className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-secondary hover:text-muted-foreground"
                >
                  <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-secondary hover:text-muted-foreground"
                >
                  <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </button>
              </div>

              <IconButton
                icon={ArrowUp}
                label="Send"
                type="submit"
                variant="default"
                disabled={!input.trim()}
              />
            </div>
          </div>
        </form>

        {/* Quick action pills — horizontal row */}
        <motion.div
          className="flex flex-wrap justify-center gap-2"
          variants={pillContainer}
          initial="hidden"
          animate="show"
        >
          {QUICK_ACTIONS.map((action) => (
            <motion.button
              key={action.label}
              variants={pillItem}
              onClick={() => handleQuickAction(action.prompt)}
              className="flex items-center gap-1.5 rounded-full border border-border/80 bg-card/80 px-3.5 py-2 text-[0.8125rem] text-muted-foreground backdrop-blur-sm transition-all hover:border-border-active hover:text-foreground hover:shadow-sm"
            >
              <action.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {action.label}
            </motion.button>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
