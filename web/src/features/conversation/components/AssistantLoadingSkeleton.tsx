"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";
import { Brain, Pencil, Wrench } from "lucide-react";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import type { AssistantPhase } from "@/shared/types";
import { normalizeToolNameI18n } from "@/features/agent-computer/lib/tool-constants";
import { useTranslation } from "@/i18n";

type TFn = (key: string, params?: Record<string, string | number>) => string;

interface AssistantLoadingSkeletonProps {
  readonly phase: AssistantPhase;
}

type ActivePhase = "thinking" | "writing" | "using_tool";

const PHASE_CONFIG: Record<
  ActivePhase,
  {
    readonly icon: typeof Brain;
    readonly badgeClass: string;
    readonly dotClass: string;
  }
> = {
  thinking: {
    icon: Brain,
    badgeClass: "bg-muted border border-border text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
  writing: {
    icon: Pencil,
    badgeClass: "bg-muted border border-border text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
  using_tool: {
    icon: Wrench,
    badgeClass: "bg-muted border border-border text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
};

/** Skeleton line widths per phase — varied to mimic real paragraphs */
const SKELETON_LINES: Record<ActivePhase, readonly string[]> = {
  thinking: ["w-[60%]", "w-[45%]", "w-[30%]"],
  writing: ["w-[85%]", "w-[70%]", "w-[90%]", "w-[50%]"],
  using_tool: ["w-[55%]", "w-[40%]"],
};

function getPhaseLabel(phase: AssistantPhase, t: TFn): string {
  if (phase.phase === "idle") return "";
  if (phase.phase === "using_tool") {
    return t("assistant.usingTool", { name: normalizeToolNameI18n(phase.toolName ?? "tool", t) });
  }
  return t(`assistant.phase.${phase.phase}`);
}

export function AssistantLoadingSkeleton({ phase }: AssistantLoadingSkeletonProps) {
  const shouldReduceMotion = useReducedMotion();
  const { t } = useTranslation();

  if (phase.phase === "idle") return null;

  const activePhase = phase.phase as ActivePhase;
  const config = PHASE_CONFIG[activePhase];
  const Icon = config.icon;
  const label = getPhaseLabel(phase, t);
  const lines = SKELETON_LINES[activePhase];

  const dur = shouldReduceMotion ? 0 : 1;

  const containerVariants: Variants = {
    hidden: { opacity: 0, y: 4 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.12 * dur,
        ease: [0.33, 1, 0.68, 1] as const,
        staggerChildren: 0.02 * dur,
      },
    },
    exit: {
      opacity: 0,
      y: -4,
      transition: { duration: 0.1 * dur },
    },
  };

  const lineVariants: Variants = {
    hidden: { opacity: 0, x: -4 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.12 * dur, ease: [0.33, 1, 0.68, 1] as const },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      role="status"
      aria-live="polite"
      aria-label={t("assistant.ariaLoading", { label })}
    >
      {/* Phase badge */}
      <div className="mb-3 flex items-center gap-2 pt-1">
        <div
          className={cn("inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-sm font-medium", config.badgeClass)}
        >
          {activePhase === "thinking" || activePhase === "using_tool" ? (
            <motion.span
              animate={shouldReduceMotion ? {} : { opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            >
              <Icon className="h-3 w-3" />
            </motion.span>
          ) : (
            <Icon className="h-3 w-3" />
          )}
          <span>{label}</span>
          <span className="flex items-center gap-0.5">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className={`inline-block h-1 w-1 rounded-full ${config.dotClass}`}
                animate={shouldReduceMotion ? {} : { opacity: [0.3, 1, 0.3] }}
                transition={{
                  duration: 1.4,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: "easeInOut",
                }}
              />
            ))}
          </span>
        </div>
      </div>

      {/* Skeleton paragraph lines */}
      <div className="flex flex-col gap-2.5 pl-1">
        {lines.map((widthClass, i) => (
          <motion.div key={`line-${i}`} variants={lineVariants}>
            <Skeleton className={`h-3 rounded-md opacity-60 ${widthClass}`} />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
