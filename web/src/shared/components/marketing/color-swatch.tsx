import * as React from "react";

import { cn } from "@/shared/lib/utils";

interface ColorSwatchProps extends React.ComponentProps<"button"> {
  color: string;
  selected?: boolean;
  label?: string;
}

/**
 * DESIGN.md `color-swatch-circle` — 32px circle with a 2px canvas ring on selection
 * over an ink-deep outer ring. Hit zone enlarged via padding to clear the WCAG AAA
 * 44px target.
 */
export function ColorSwatch({
  color,
  selected,
  label,
  className,
  ...props
}: ColorSwatchProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label ?? color}
      data-slot="color-swatch"
      data-selected={selected || undefined}
      className={cn(
        "relative inline-flex size-11 items-center justify-center rounded-full p-1.5 outline-none transition-shadow",
        "focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        className,
      )}
      {...props}
    >
      <span
        className="block size-8 rounded-full"
        style={{
          background: color,
          boxShadow: selected
            ? "0 0 0 2px var(--color-canvas), 0 0 0 4px var(--color-ink-deep)"
            : "0 0 0 1px var(--color-ai-border)",
        }}
      />
    </button>
  );
}
