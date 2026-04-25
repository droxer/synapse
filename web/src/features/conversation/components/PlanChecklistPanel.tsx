"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check, X, AlertCircle, Minus } from "lucide-react";
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
  if (status === "skipped") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-muted flex-shrink-0">
        <Minus className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={2.5} />
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
  if (status === "replan_required") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-accent-amber/15 flex-shrink-0">
        <AlertCircle className="h-2.5 w-2.5 text-accent-amber" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex h-4 w-4 items-center justify-center flex-shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-focus animate-pulsing-dot-fade" />
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 items-center justify-center flex-shrink-0">
      <span className="h-1 w-1 rounded-full bg-border-active" />
    </span>
  );
}

type TFn = (key: string, params?: Record<string, string | number>) => string;

function getLocalizedStepName(step: PlanStep, t: TFn): string {
  return step.nameI18nKey ? t(step.nameI18nKey) : step.name;
}

function getLocalizedStepDescription(step: PlanStep, t: TFn): string {
  return step.descriptionI18nKey ? t(step.descriptionI18nKey) : step.description;
}

function StepRow({ step, index, t }: { readonly step: PlanStep; readonly index: number; readonly t: TFn }) {
  const isComplete = step.status === "complete";
  const isSkipped = step.status === "skipped";
  const isError = step.status === "error";
  const isReplanRequired = step.status === "replan_required";
  const isRunning = step.status === "running";
  const name = getLocalizedStepName(step, t);
  const description = getLocalizedStepDescription(step, t);

  return (
    <motion.li
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.14, ease: "easeOut", delay: index * 0.03 }}
      className={cn(
        "group relative flex items-start gap-2.5 px-3 py-2 rounded-md transition-colors",
        isRunning && "bg-focus/[0.04]",
        isSkipped && "opacity-70",
        !isRunning && !isComplete && !isSkipped && !isError && !isReplanRequired && "opacity-60",
      )}
    >
      {/* Left status bar */}
      <span
        className={cn(
          "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full transition-colors",
          isComplete && "bg-accent-emerald",
          isSkipped && "bg-border-active",
          isError && "bg-destructive",
          isReplanRequired && "bg-accent-amber",
          isRunning && "bg-focus",
          !isRunning && !isComplete && !isSkipped && !isError && !isReplanRequired && "bg-border",
        )}
      />

      <StepIndicator status={step.status} />

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm leading-snug",
            isComplete && "text-muted-foreground line-through decoration-muted-foreground/40",
            isSkipped && "text-muted-foreground",
            isError && "text-destructive",
            isReplanRequired && "text-accent-amber",
            isRunning && "text-foreground font-medium",
            !isRunning && !isComplete && !isSkipped && !isError && !isReplanRequired && "text-muted-foreground",
          )}
        >
          {name}
        </p>
        {description && !isComplete && !isSkipped && (
          <p className="mt-0.5 text-caption text-muted-foreground-dim leading-snug line-clamp-2">
            {description}
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

      {(isError || isReplanRequired) && (
        <span className="flex-shrink-0 mt-0.5">
          <AlertCircle className={cn("h-3 w-3", isError ? "text-destructive/70" : "text-accent-amber/70")} />
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

  const resolvedCount = planSteps.filter((s) => s.status === "complete" || s.status === "skipped").length;
  const hasError = planSteps.some((s) => s.status === "error" || s.status === "replan_required");
  const progressPct = Math.round((resolvedCount / planSteps.length) * 100);

  return (
    <div className="overflow-hidden rounded-xl bg-muted/30">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2">
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
              : resolvedCount === planSteps.length
                ? "status-ok"
                : "status-neutral",
          )}
        >
          {t("plan.progress", { completed: resolvedCount, total: planSteps.length })}
        </span>
      </div>

      {/* Steps */}
      <ul className="py-1">
        <AnimatePresence initial={false}>
          {planSteps.map((step, i) => (
            <StepRow key={`${step.nameI18nKey ?? step.name}-${i}`} step={step} index={i} t={t} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
