"use client";

import { cn } from "@/shared/lib/utils";

interface PulsingDotProps {
  readonly size?: "sm" | "md";
  readonly className?: string;
}

export function PulsingDot({ size = "sm", className }: PulsingDotProps) {
  const sizeClass = size === "md" ? "h-2 w-2" : "h-1.5 w-1.5";

  return (
    <span className={cn("relative shrink-0", sizeClass, className)}>
      <span className={cn("absolute inset-0 rounded-full bg-focus animate-[pulsingDotFade_2s_ease-in-out_infinite]")} />
      <span className="absolute inset-0 rounded-full bg-focus animate-[pulsingDotRing_2s_ease-out_infinite]" />
    </span>
  );
}
