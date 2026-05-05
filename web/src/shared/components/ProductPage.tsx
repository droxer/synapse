"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/shared/lib/utils";

interface ProductPageHeaderProps {
  readonly icon: ReactNode;
  readonly eyebrow: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly stats?: ReactNode;
  readonly className?: string;
  readonly innerClassName?: string;
  readonly statsClassName?: string;
}

interface ProductSectionHeaderProps {
  readonly eyebrow?: ReactNode;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

interface ProductStatCardProps {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly className?: string;
}

export function ProductPageHeader({
  icon,
  eyebrow,
  title,
  description,
  actions,
  stats,
  className,
  innerClassName,
  statsClassName,
}: ProductPageHeaderProps) {
  return (
    <motion.header
      className={cn("shrink-0 px-4 py-5 sm:px-6", className)}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      <div className={cn("mx-auto max-w-6xl space-y-4", innerClassName)}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="chip-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-lg">
              {icon}
            </div>
            <div className="min-w-0">
              <p className="label-mono text-muted-foreground-dim">{eyebrow}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                {title}
              </h1>
              {description ? (
                <div className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {description}
                </div>
              ) : null}
            </div>
          </div>
          {actions ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {actions}
            </div>
          ) : null}
          {stats ? (
            <div className={cn("grid gap-2 sm:grid-cols-2 lg:min-w-[22rem]", statsClassName)}>
              {stats}
            </div>
          ) : null}
        </div>
      </div>
    </motion.header>
  );
}

export function ProductSectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: ProductSectionHeaderProps) {
  return (
    <section
      className={cn(
        "surface-panel flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className="label-mono text-muted-foreground-dim">{eyebrow}</p>
        ) : null}
        {title ? (
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        ) : null}
        {description ? (
          <div className={cn("text-sm text-muted-foreground", eyebrow || title ? "mt-1" : undefined)}>
            {description}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {actions}
        </div>
      ) : null}
    </section>
  );
}

export function ProductStatCard({
  label,
  value,
  description,
  icon,
  className,
}: ProductStatCardProps) {
  return (
    <div className={cn("surface-panel px-4 py-3", className)}>
      <div className="flex items-center gap-2">
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
        <span className="label-mono text-muted-foreground-dim">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </div>
      {description ? (
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      ) : null}
    </div>
  );
}
