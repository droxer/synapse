"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check, X, AlertCircle } from "lucide-react";
import { useTranslation } from "@/i18n";
import { cn } from "@/shared/lib/utils";
import type { PlanStep } from "@/shared/types";

interface PlanChecklistPanelProps {
  readonly planSteps: readonly PlanStep[];
}

function StepIndicator({ status }: { readonly status: PlanStep["status"] }) {
  if (status === "complete") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-accent-emerald/15 flex-shrink-0">
        <Check className="h-2.5 w-2.5 text-accent-emerald" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-destructive/10 flex-shrink-0">
        <X className="h-2.5 w-2.5 text-destructive" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="relative flex h-4 w-4 items-center justify-center flex-shrink-0">
        <span className="absolute h-2 w-2 rounded-full bg-focus opacity-30 animate-pulsing-dot-ring" />
        <span className="h-1.5 w-1.5 rounded-full bg-focus" />
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 items-center justify-center flex-shrink-0">
      <span className="h-1 w-1 rounded-full bg-border-active" />
    </span>
  );
}

function StepRow({ step, index }: { readonly step: PlanStep; readonly index: number }) {
  const isComplete = step.status === "complete";
  const isError = step.status === "error";
  const isRunning = step.status === "running";

  return (
    <motion.li
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.14, ease: "easeOut", delay: index * 0.03 }}
      className={cn(
        "group relative flex items-start gap-2.5 px-3 py-2 rounded-md transition-colors",
        isRunning && "bg-focus/[0.04]",
        !isRunning && !isComplete && !isError && "opacity-60",
      )}
    >
      {/* Left status bar */}
      <span
        className={cn(
          "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full transition-colors",
          isComplete && "bg-accent-emerald",
          isError && "bg-destructive",
          isRunning && "bg-focus",
          !isRunning && !isComplete && !isError && "bg-border",
        )}
      />

      <StepIndicator status={step.status} />

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm leading-snug",
            isComplete && "text-muted-foreground line-through decoration-muted-foreground/40",
            isError && "text-destructive",
            isRunning && "text-foreground font-medium",
            !isRunning && !isComplete && !isError && "text-muted-foreground",
          )}
        >
          {step.name}
        </p>
        {step.description && !isComplete && (
          <p className="mt-0.5 text-caption text-muted-foreground-dim leading-snug line-clamp-2">
            {step.description}
          </p>
        )}
        {isRunning && (
          <div className="mt-1.5 h-0.5 w-full rounded-full overflow-hidden bg-focus/10">
            <motion.div
              className="h-full bg-focus/60 rounded-full"
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity }}
            />
          </div>
        )}
      </div>

      {isError && (
        <span className="flex-shrink-0 mt-0.5">
          <AlertCircle className="h-3 w-3 text-destructive/70" />
        </span>
      )}
    </motion.li>
  );
}

export function PlanChecklistPanel({ planSteps }: PlanChecklistPanelProps) {
  const { t } = useTranslation();

  if (planSteps.length === 0) {
    return null;
  }

  const completedCount = planSteps.filter((s) => s.status === "complete").length;
  const errorCount = planSteps.filter((s) => s.status === "error").length;
  const progressPct = Math.round((completedCount / planSteps.length) * 100);
  const hasError = errorCount > 0;

  return (
    <div className="surface-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        <span className="label-mono text-muted-foreground flex-1">
          {t("plan.title")}
        </span>

        {/* Progress bar */}
        <div className="flex-1 max-w-[5rem] h-1 rounded-full bg-secondary overflow-hidden">
          <motion.div
            className={cn(
              "h-full rounded-full transition-colors",
              hasError ? "bg-accent-amber" : "bg-accent-emerald",
            )}
            initial={{ width: 0 }}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>

        <span
          className={cn(
            "status-pill tabular-nums",
            hasError
              ? "status-warn"
              : completedCount === planSteps.length
                ? "status-ok"
                : "status-neutral",
          )}
        >
          {t("plan.progress", { completed: completedCount, total: planSteps.length })}
        </span>
      </div>

      {/* Steps */}
      <ul className="py-1">
        <AnimatePresence initial={false}>
          {planSteps.map((step, i) => (
            <StepRow key={`${step.name}-${i}`} step={step} index={i} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
