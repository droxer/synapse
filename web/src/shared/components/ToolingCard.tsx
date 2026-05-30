"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

interface ToolingCardProps {
  readonly icon: ReactNode;
  readonly badge?: ReactNode;
  readonly headerActions?: ReactNode;
  readonly title: ReactNode;
  readonly body?: ReactNode;
  readonly footerLeft?: ReactNode;
  readonly footerRight?: ReactNode;
  readonly href?: string;
  readonly accessibleLabel?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Shared card surface for tooling-style entities (skills, MCP servers).
 *
 * Layout: 9×9 icon chip top-left, badge + header actions top-right,
 * title, body (≥ 2.5rem reserved), footer (slug left, toggle right).
 *
 * When `href` is set, an absolutely-positioned Link covers the card and
 * navigates on click. Interactive children with `relative z-10` sit above
 * the Link and capture their own clicks — no stopPropagation needed.
 */
export function ToolingCard({
  icon,
  badge,
  headerActions,
  title,
  body,
  footerLeft,
  footerRight,
  href,
  accessibleLabel,
  disabled = false,
  className,
}: ToolingCardProps) {
  return (
    <article
      className={cn(
        "surface-panel group relative flex h-full flex-col p-4",
        "transition-[border-color,background-color] duration-200 ease-out",
        disabled
          ? "opacity-90"
          : "hover:border-charcoal hover:bg-surface-soft",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="chip-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
          {icon}
        </div>
        {(badge || headerActions) && (
          <div className="relative z-10 flex items-center gap-1.5">
            {badge}
            {headerActions}
          </div>
        )}
      </div>

      <h3
        className={cn(
          "mt-3 text-sm font-semibold leading-snug",
          disabled ? "text-steel" : "text-ink-deep",
        )}
      >
        {title}
      </h3>

      {body !== undefined && <div className="mt-1.5 min-h-[2.5rem]">{body}</div>}

      {(footerLeft || footerRight) && (
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {footerLeft ? (
            <div className="min-w-0 flex-1">{footerLeft}</div>
          ) : (
            <span />
          )}
          {footerRight ? (
            <div className="relative z-10 shrink-0">{footerRight}</div>
          ) : null}
        </div>
      )}

      {href ? (
        <Link
          href={href}
          aria-label={accessibleLabel}
          className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {accessibleLabel ? <span className="sr-only">{accessibleLabel}</span> : null}
        </Link>
      ) : null}
    </article>
  );
}

export function ToolingCardSkeleton() {
  return (
    <div className="surface-panel flex flex-col p-4">
      <div className="flex items-start justify-between">
        <div className="h-9 w-9 shrink-0 rounded-lg skeleton-shimmer" />
        <div className="h-4 w-14 skeleton-shimmer" />
      </div>
      <div className="mt-3 h-4 w-28 skeleton-shimmer" />
      <div className="mt-2 min-h-[2.5rem] space-y-1.5">
        <div className="h-3 w-full skeleton-shimmer" />
        <div className="h-3 w-3/4 skeleton-shimmer" />
      </div>
      <div className="mt-auto pt-3">
        <div className="h-2.5 w-24 skeleton-shimmer" />
      </div>
    </div>
  );
}

export function ToolingCardSkeletonGrid({ count = 6 }: { readonly count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <ToolingCardSkeleton key={i} />
      ))}
    </div>
  );
}
