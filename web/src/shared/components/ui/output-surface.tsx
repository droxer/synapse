"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

export const OUTPUT_SURFACE_FOCUS_CLASSES =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export const OUTPUT_SURFACE_ROOT_CLASSES =
  "surface-panel mt-2 overflow-hidden rounded-xl px-0 py-0";
export const OUTPUT_SURFACE_HEADER_CLASSES =
  "flex items-center gap-1.5 border-b border-hairline-soft/60 px-3 py-2";
export const OUTPUT_SURFACE_LABEL_CLASSES =
  "text-sm font-medium text-steel";
export const OUTPUT_SURFACE_META_CLASSES =
  "text-micro text-stone";
export const OUTPUT_SURFACE_BODY_CLASSES = "px-3 py-2";
export const OUTPUT_SURFACE_INNER_CLASSES =
  "rounded-lg border border-hairline-soft bg-surface-soft px-2.5 py-2";
export const OUTPUT_SURFACE_INNER_DENSE_CLASSES =
  "rounded-lg border border-hairline-soft bg-surface-soft px-2 py-1.5";

interface OutputSurfaceProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function OutputSurface({ children, className }: OutputSurfaceProps) {
  return <div className={cn(OUTPUT_SURFACE_ROOT_CLASSES, className)}>{children}</div>;
}

interface OutputSurfaceHeaderProps {
  readonly icon?: ReactNode;
  readonly label?: ReactNode;
  readonly meta?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function OutputSurfaceHeader({
  icon,
  label,
  meta,
  action,
  className,
}: OutputSurfaceHeaderProps) {
  if (!icon && !label && !meta && !action) return null;

  return (
    <div className={cn(OUTPUT_SURFACE_HEADER_CLASSES, className)}>
      {icon}
      {label ? <span className={OUTPUT_SURFACE_LABEL_CLASSES}>{label}</span> : null}
      {meta ? <span className={OUTPUT_SURFACE_META_CLASSES}>{meta}</span> : null}
      {action ? <div className="ml-auto flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}

interface OutputSurfaceBodyProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function OutputSurfaceBody({ children, className }: OutputSurfaceBodyProps) {
  return <div className={cn(OUTPUT_SURFACE_BODY_CLASSES, className)}>{children}</div>;
}

interface OutputSurfaceInnerProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly dense?: boolean;
}

export function OutputSurfaceInner({
  children,
  className,
  dense = false,
}: OutputSurfaceInnerProps) {
  return (
    <div
      className={cn(
        dense ? OUTPUT_SURFACE_INNER_DENSE_CLASSES : OUTPUT_SURFACE_INNER_CLASSES,
        className,
      )}
    >
      {children}
    </div>
  );
}
