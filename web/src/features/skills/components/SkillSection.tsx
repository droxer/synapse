"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

interface SkillSectionProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly count: number;
  readonly className?: string;
  readonly children: ReactNode;
}

export function SkillSection({
  icon: Icon,
  title,
  description,
  count,
  className,
  children,
}: SkillSectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <div>
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <span className="status-pill status-neutral tabular-nums">
            {count}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
