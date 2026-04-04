"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Brain, Pencil, Wrench } from "lucide-react";
import type { AssistantPhase } from "@/shared/types";
import { normalizeToolNameI18n } from "@/features/agent-computer/lib/tool-constants";
import { useTranslation } from "@/i18n";

interface AssistantStateIndicatorProps {
  readonly phase: AssistantPhase;
}

const PHASE_CONFIG = {
  thinking: {
    icon: Brain,
    className: "bg-accent-amber/10 border-accent-amber/25 text-accent-amber",
  },
  writing: {
    icon: Pencil,
    className: "bg-ai-glow/10 border-ai-glow/25 text-ai-glow",
  },
  using_tool: {
    icon: Wrench,
    className: "bg-accent-purple/10 border-accent-purple/25 text-accent-purple",
  },
} as const;

export function AssistantStateIndicator({ phase }: AssistantStateIndicatorProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();

  if (phase.phase === "idle") return null;

  const config = PHASE_CONFIG[phase.phase];
  const Icon = config.icon;
  const label = phase.phase === "using_tool"
    ? t("assistant.usingToolLive", { name: normalizeToolNameI18n(phase.toolName ?? "tool", t) })
    : t(`assistant.phaseLive.${phase.phase}`);

  return (
    <motion.div
      key={phase.phase}
      className="flex justify-start"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      <div
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-sm ${config.className}`}
      >
        {phase.phase === "thinking" || phase.phase === "using_tool" ? (
          <motion.span
            animate={prefersReducedMotion ? {} : { opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <Icon className="h-3.5 w-3.5" />
          </motion.span>
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
        {label}
      </div>
    </motion.div>
  );
}
