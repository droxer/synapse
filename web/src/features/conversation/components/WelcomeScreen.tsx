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
  const { t } = useTranslation();
  const heading = t("welcome.heading");
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
        transition={{ duration: 0.12 }}
      >
        {/* Heading — single fade-in (Hero type scale per design guide) */}
        <motion.h1
          className="mb-8 text-center font-sans text-2xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-[3.75rem]"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
        >
          {heading}
        </motion.h1>

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
              className="flex w-full items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setDismissed(true)}
                className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
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
