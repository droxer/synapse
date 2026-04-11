"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChatInput } from "./ChatInput";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { useTranslation } from "@/i18n";

interface HomeScreenProps {
  onSubmitTask: (task: string, files?: File[], skills?: string[], usePlanner?: boolean) => void;
  error?: string | null;
  isLoading?: boolean;
}

export function HomeScreen({ onSubmitTask, error, isLoading = false }: HomeScreenProps) {
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
      <motion.div
        className="relative z-10 flex w-full max-w-3xl flex-col items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.12 }}
      >
        {/* Heading — single fade-in (Hero type scale per design guide) */}
        <motion.h1
          className="heading-display mb-8 text-center text-foreground"
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
              transition={{ duration: 0.15 }}
              className="w-full"
            >
              <ErrorBanner message={error} onDismiss={() => setDismissed(true)} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
