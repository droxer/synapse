"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChatInput } from "./ChatInput";
import { useTranslation } from "@/i18n";
import { X } from "lucide-react";

interface WelcomeScreenProps {
  onSubmitTask: (task: string, files?: File[], skills?: string[], usePlanner?: boolean) => void;
  error?: string | null;
  isLoading?: boolean;
}

export function WelcomeScreen({ onSubmitTask, error, isLoading = false }: WelcomeScreenProps) {
  const { tArray } = useTranslation();
  const headingWords = tArray("welcome.headingWords");
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state when a new error arrives
  useEffect(() => {
    if (error) setDismissed(false);
  }, [error]);

  const showError = error && !dismissed;

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-4 sm:px-6">
      {/* Subtle warm radial background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(ellipse 70% 50% at 50% 45%, var(--color-ai-surface) 0%, transparent 70%)",
        }}
      />

      <motion.div
        className="relative z-10 flex w-full max-w-3xl flex-col items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {/* Staggered word reveal heading */}
        <h1 className="mb-8 text-center font-serif text-[2rem] font-semibold leading-[1.15] tracking-tight text-foreground sm:text-[2.75rem] md:text-[3.25rem]">
          {headingWords.map((word, i) => (
            <motion.span
              key={i}
              className="inline-block mr-[0.3em]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.35,
                delay: i * 0.05,
                ease: "easeOut",
              }}
            >
              {word}
            </motion.span>
          ))}
        </h1>

        {/* Input card — delegates to ChatInput with welcome variant */}
        <div className="mb-6 w-full">
          <ChatInput
            onSendMessage={onSubmitTask}
            variant="welcome"
            disabled={isLoading}
            isAgentRunning={isLoading}
          />
        </div>

        {/* Error banner */}
        <AnimatePresence>
          {showError && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex w-full items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
            >
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setDismissed(true)}
                className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/50"
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
