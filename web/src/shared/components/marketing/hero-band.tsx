import * as React from "react";

import { cn } from "@/shared/lib/utils";

interface HeroBandProps extends Omit<React.ComponentProps<"section">, "title"> {
  /** Optional photographic background (rendered behind a soft overlay for legibility). */
  backgroundImage?: string;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Dual-CTA pair — render the marketing primary first, secondary outline second. */
  actions?: React.ReactNode;
}

/**
 * DESIGN.md `hero-band-marketing` — full-bleed photographic hero with overlaid copy
 * and a dual-CTA pair (black pill primary + outlined ghost secondary).
 *
 * - 32px corner rounding (`rounded-xxxl`) is the brand's photographic-card signature.
 * - Section padding follows the spacing scale: `section-lg` (80px) at md+, `hero` (120px) at lg+.
 */
export function HeroBand({
  className,
  backgroundImage,
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  ...props
}: HeroBandProps) {
  const hasImage = Boolean(backgroundImage);
  return (
    <section
      data-slot="hero-band"
      data-has-image={hasImage || undefined}
      className={cn(
        "relative isolate flex w-full flex-col items-start justify-end overflow-hidden",
        "rounded-xxxl px-8 py-20 md:px-16 md:py-[80px] lg:py-[120px]",
        hasImage ? "text-canvas" : "bg-surface-soft text-ink-deep",
        className,
      )}
      style={
        hasImage
          ? {
              backgroundImage: `linear-gradient(180deg, color-mix(in srgb, var(--color-ink-deep) 5%, transparent) 0%, color-mix(in srgb, var(--color-ink-deep) 55%, transparent) 100%), url(${backgroundImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
      {...props}
    >
      <div className="flex max-w-[640px] flex-col gap-5">
        {eyebrow ? (
          <span className="text-body-sm-bold uppercase tracking-[0.08em] opacity-90">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="text-display-lg text-balance md:text-hero-display">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-subtitle-md max-w-[520px] opacity-90">{subtitle}</p>
        ) : null}
        {actions ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">{actions}</div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
