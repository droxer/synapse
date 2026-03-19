"use client";

import { motion } from "framer-motion";
import { Brain, Pencil, Wrench } from "lucide-react";
import type { AssistantPhase } from "@/shared/types";
import { normalizeToolName } from "@/features/agent-computer/lib/tool-constants";

interface AssistantStateIndicatorProps {
  readonly phase: AssistantPhase;
}

const PHASE_CONFIG = {
  thinking: {
    icon: Brain,
    label: "Thinking...",
    className: "bg-accent-amber/10 border-accent-amber/25 text-accent-amber",
  },
  writing: {
    icon: Pencil,
    label: "Writing...",
    className: "bg-ai-glow/10 border-ai-glow/25 text-ai-glow",
  },
  using_tool: {
    icon: Wrench,
    label: "Using tool...",
    className: "bg-accent-purple/10 border-accent-purple/25 text-accent-purple",
  },
} as const;

export function AssistantStateIndicator({ phase }: AssistantStateIndicatorProps) {
  if (phase.phase === "idle") return null;

  const config = PHASE_CONFIG[phase.phase];
  const Icon = config.icon;
  const label = phase.phase === "using_tool" ? `Using ${normalizeToolName(phase.toolName ?? "tool")}...` : config.label;

  return (
    <motion.div
      key={phase.phase}
      className="flex justify-start"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <div
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${config.className}`}
      >
        {phase.phase === "thinking" ? (
          <motion.span
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <Icon className="h-3.5 w-3.5" />
          </motion.span>
        ) : phase.phase === "using_tool" ? (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
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
