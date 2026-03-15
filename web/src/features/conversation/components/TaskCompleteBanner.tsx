"use client";

import { motion } from "framer-motion";
import { CircleCheck } from "lucide-react";
import { SuggestedCard } from "./SuggestedCard";

export function TaskCompleteBanner() {
  return (
    <motion.div
      className="mt-6"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, delay: 0.1 }}
        >
          <CircleCheck className="h-5 w-5 text-accent-emerald" />
        </motion.div>
        <span className="text-sm font-medium text-foreground">
          Task completed
        </span>
      </div>

      {/* Suggested follow-ups */}
      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          Suggested follow-ups
        </p>
        <div className="grid grid-cols-2 gap-2">
          <SuggestedCard text="Explain the result in detail" />
          <SuggestedCard text="Make modifications" />
        </div>
      </div>
    </motion.div>
  );
}
