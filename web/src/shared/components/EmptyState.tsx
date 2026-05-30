"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title?: string;
  readonly description: string;
  readonly dashed?: boolean;
  readonly className?: string;
  readonly animate?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  dashed = false,
  className,
  animate = true,
}: EmptyStateProps) {
  const Container = animate ? motion.div : "div";
  const motionProps = animate
    ? {
        initial: { opacity: 0, y: 4 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.15, ease: "easeOut" as const },
      }
    : {};

  return (
    <Container
      className={cn(
        "flex flex-col items-center justify-center gap-3",
        dashed && "rounded-lg border border-dashed border-hairline-soft py-14",
        className,
      )}
      {...motionProps}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-soft">
        <Icon className="h-5 w-5 text-stone" />
      </div>
      {title || description ? (
        <div className="text-center">
          {title && (
            <p className="text-sm font-medium text-ink-deep">{title}</p>
          )}
          <p className={cn("text-xs text-steel", title && "mt-0.5")}>
            {description}
          </p>
        </div>
      ) : null}
    </Container>
  );
}
