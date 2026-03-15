"use client";

import { CircleCheck, Loader2, GitFork, CircleX } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { AgentStatus } from "@/shared/types";

interface AgentStatusRowProps {
  readonly agent: AgentStatus;
  readonly variant?: "light" | "dark";
}

export function AgentStatusRow({ agent, variant = "light" }: AgentStatusRowProps) {
  const isDark = variant === "dark";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs",
        isDark ? "bg-white/5" : "bg-muted",
      )}
    >
      {agent.status === "complete" ? (
        <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      ) : agent.status === "error" ? (
        <CircleX className="h-3.5 w-3.5 shrink-0 text-rose-500" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-500" />
      )}
      <GitFork className={cn("h-3 w-3 shrink-0", isDark ? "text-white/20" : "text-muted-foreground/50")} />
      <span className={cn("flex-1 truncate font-sans", isDark ? "text-[var(--color-terminal-text)]" : "text-foreground")}>
        {agent.description}
      </span>
      <span className={cn("ml-auto font-mono text-micro", isDark ? "text-[var(--color-terminal-dim)]" : "text-muted-foreground")}>
        {agent.agentId.slice(0, 8)}
      </span>
    </div>
  );
}
