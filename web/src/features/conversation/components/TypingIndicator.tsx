"use client";

import { motion } from "framer-motion";
import { useTranslation } from "@/i18n";

const DOT_INDICES = [0, 1, 2] as const;

export function TypingIndicator() {
  const { t } = useTranslation();
  return (
    <motion.div
      className="flex justify-start"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      <div
        role="status"
        aria-label={t("typing.ariaLabel")}
        aria-live="polite"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3.5 py-2"
      >
        {DOT_INDICES.map((i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-focus"
            animate={{
              opacity: [0.4, 1, 0.4],
            }}
            transition={{
              duration: 1.4,
              repeat: Infinity,
              delay: i * 0.2,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}
