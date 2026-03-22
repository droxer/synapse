"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckSquare, XSquare, Loader2, ListChecks, Square } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { PlanStep } from "@/shared/types";

interface PlanChecklistPanelProps {
  readonly planSteps: PlanStep[];
}

function StepIcon({ status }: { readonly status: PlanStep["status"] }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-user-accent" />;
    case "complete":
      return <CheckSquare className="h-4 w-4 text-accent-emerald" />;
    case "error":
      return <XSquare className="h-4 w-4 text-destructive" />;
    default:
      return <Square className="h-4 w-4 text-muted-foreground" />;
  }
}

export function PlanChecklistPanel({ planSteps }: PlanChecklistPanelProps) {
  const { t } = useTranslation();

  if (planSteps.length === 0) {
    return null;
  }

  const completedCount = planSteps.filter(
    (s) => s.status === "complete",
  ).length;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <ListChecks className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          {t("plan.title")}
        </span>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {t("plan.progress", {
            completed: completedCount,
            total: planSteps.length,
          })}
        </span>
      </div>

      {/* Checklist items */}
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {planSteps.map((step, i) => (
            <motion.li
              key={`${step.name}-${i}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="flex items-start gap-2"
            >
              <span className="mt-0.5 flex-shrink-0">
                <StepIcon status={step.status} />
              </span>
              <span
                className={
                  step.status === "complete"
                    ? "text-sm text-muted-foreground line-through"
                    : step.status === "error"
                      ? "text-sm text-destructive"
                      : "text-sm text-foreground"
                }
              >
                {step.name}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
