import * as React from "react";

import { cn } from "@/shared/lib/utils";

type PromoBannerTone = "ink" | "yellow";

interface PromoBannerProps extends React.ComponentProps<"div"> {
  tone?: PromoBannerTone;
  /** Inline link rendered to the right of the message. */
  action?: React.ReactNode;
}

const toneClass: Record<PromoBannerTone, string> = {
  ink: "bg-ink-deep text-canvas",
  yellow: "bg-warning text-ink-deep",
};

/**
 * DESIGN.md `promo-banner` — full-width strip docked above the top nav.
 * Carries one-line offer copy plus an inline link/CTA.
 * Typography matches `text-body-sm-bold` (14 / 700 / -0.14px / 1.43).
 */
export function PromoBanner({
  className,
  tone = "ink",
  action,
  children,
  ...props
}: PromoBannerProps) {
  return (
    <div
      data-slot="promo-banner"
      data-tone={tone}
      className={cn(
        "flex w-full items-center justify-center gap-3 px-6 py-3",
        "text-body-sm-bold",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {action ? (
        <span className="shrink-0 underline-offset-2 hover:underline">{action}</span>
      ) : null}
    </div>
  );
}
