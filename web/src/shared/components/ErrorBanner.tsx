"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface ErrorBannerProps {
  readonly message: string;
  readonly onDismiss: () => void;
  readonly variant?: "default" | "compact";
  readonly dismissLabel?: string;
}

export function ErrorBanner({ message, onDismiss, variant = "default", dismissLabel = "Dismiss error" }: ErrorBannerProps) {
  const isCompact = variant === "compact";

  return (
    <motion.div
      role="alert"
      className={cn(
        "flex items-center gap-2 border border-destructive bg-destructive/5",
        isCompact
          ? "rounded-md px-3 py-2"
          : "rounded-lg px-4 py-2.5",
      )}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
      <p className="flex-1 text-sm text-destructive">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="rounded-sm p-0.5 text-destructive/60 transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}
