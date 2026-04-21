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
    <div className="flex h-full w-full flex-col items-center justify-center px-4 sm:px-6">
      <div className="flex w-full max-w-2xl flex-col">
        <motion.div
          className="flex flex-col items-center gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1
            className="heading-display max-w-xl text-center text-foreground"
            style={{ fontSize: "clamp(1.75rem, 1.2rem + 2.5vw, 2.75rem)" }}
          >
            {heading}
          </h1>
          <p className="max-w-lg text-center text-sm text-muted-foreground">
            {t("welcome.subtitle")}
          </p>
        </motion.div>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        >
          <ChatInput
            onSendMessage={onSubmitTask}
            variant="welcome"
            disabled={isLoading}
            isAgentRunning={isLoading}
          />
        </motion.div>

        <AnimatePresence>
          {showError && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="mt-4 w-full"
            >
              <ErrorBanner message={error} onDismiss={() => setDismissed(true)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
