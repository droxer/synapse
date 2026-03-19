"use client";

import { motion } from "framer-motion";
import { PulsingDot } from "@/shared/components/PulsingDot";
import { Skeleton } from "@/shared/components/ui/skeleton";
import type { AssistantPhase } from "@/shared/types";
import { normalizeToolName } from "@/features/agent-computer/lib/tool-constants";

interface AssistantLoadingSkeletonProps {
  readonly phase: AssistantPhase;
}

function getPhaseLabel(phase: AssistantPhase): string {
  switch (phase.phase) {
    case "thinking":
      return "Thinking...";
    case "writing":
      return "Writing...";
    case "using_tool":
      return `Using ${normalizeToolName(phase.toolName ?? "tool")}...`;
    default:
      return "";
  }
}

export function AssistantLoadingSkeleton({ phase }: AssistantLoadingSkeletonProps) {
  if (phase.phase === "idle") return null;

  const label = getPhaseLabel(phase);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      {/* AI indicator row */}
      <div className="mb-2 flex items-center gap-2" role="status" aria-live="polite">
        <PulsingDot size="md" />
        <span className="text-xs font-medium tracking-wide text-accent-purple/70 uppercase">
          HiAgent
        </span>
      </div>

      {/* Shimmer skeleton + phase label */}
      <div className="pl-[18px] space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-accent-purple/70">{label}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    </motion.div>
  );
}
