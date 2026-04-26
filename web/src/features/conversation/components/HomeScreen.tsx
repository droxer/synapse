"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
  const shouldReduceMotion = useReducedMotion();
  const heading = t("welcome.heading");
  const [dismissed, setDismissed] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<{ id: number; text: string } | null>(null);
  const [composerHasContent, setComposerHasContent] = useState(false);
  const [suggestionStatus, setSuggestionStatus] = useState("");

  const suggestions = [
    {
      label: t("welcome.suggestion.prototype"),
      prompt: t("welcome.suggestion.prototypePrompt"),
    },
    {
      label: t("welcome.suggestion.improve"),
      prompt: t("welcome.suggestion.improvePrompt"),
    },
    {
      label: t("welcome.suggestion.planBuild"),
      prompt: t("welcome.suggestion.planBuildPrompt"),
    },
  ];

  // Reset dismissed state when a new error arrives
  useEffect(() => {
    if (error) setDismissed(false);
  }, [error]);

  const showError = error && !dismissed;
  const showSuggestions = !composerHasContent;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-4 sm:px-6">
      <div className="flex w-full max-w-2xl flex-col">
        <motion.div
          className="flex flex-col items-center gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="heading-display max-w-2xl text-center text-foreground">
            {heading}
          </h1>
          <p className="max-w-lg text-center text-sm text-muted-foreground">
            {t("welcome.subtitle")}
          </p>
          <AnimatePresence initial={false}>
            {showSuggestions && (
              <motion.section
                className="mt-2 flex flex-wrap justify-center gap-2"
                initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -4 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}
                role="group"
                aria-labelledby="welcome-suggestions-heading"
              >
                <h2 id="welcome-suggestions-heading" className="sr-only">
                  {t("welcome.suggestionsLabel")}
                </h2>
                {suggestions.map((suggestion) => (
                  <motion.button
                    key={suggestion.label}
                    type="button"
                    disabled={isLoading}
                    whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.15, ease: "easeOut" }}
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-[background-color,border-color,color,opacity] duration-150 hover:border-border-active hover:bg-secondary hover:text-foreground active:border-border-active active:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      setDraftPrompt((current) => ({
                        id: (current?.id ?? 0) + 1,
                        text: suggestion.prompt,
                      }));
                      setComposerHasContent(true);
                      setSuggestionStatus(t("welcome.suggestion.addedStatus", { label: suggestion.label }));
                    }}
                  >
                    <span>{suggestion.label}</span>
                    <span className="sr-only"> {t("welcome.suggestion.actionHint")}</span>
                  </motion.button>
                ))}
              </motion.section>
            )}
          </AnimatePresence>
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {suggestionStatus}
          </div>
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
            draftMessage={draftPrompt}
            onContentStateChange={setComposerHasContent}
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
