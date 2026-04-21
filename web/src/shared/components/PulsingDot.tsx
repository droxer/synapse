"use client";

import { cn } from "@/shared/lib/utils";

interface PulsingDotProps {
  readonly size?: "sm" | "md";
  readonly className?: string;
}

export function PulsingDot({ size = "sm", className }: PulsingDotProps) {
  const sizeClass = size === "md" ? "h-2 w-2" : "h-1.5 w-1.5";

  return (
    <span className={cn("inline-flex shrink-0 rounded-full bg-focus animate-pulsing-dot-fade", sizeClass, className)} />
  );
}
