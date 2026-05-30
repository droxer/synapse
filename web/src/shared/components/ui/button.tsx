import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/shared/lib/utils"

/**
 * DESIGN.md button system — all variants are pill-shaped (rounded.full = 100px).
 *
 * - `default` (commerce primary): cobalt fill, white text. Send/Run/Submit/Continue.
 * - `marketing` (marketing primary): black pill, white text. Landing/login CTAs.
 * - `secondary`: outlined ghost with 2px ink-deep border.
 * - `ghost`: transparent with a 1px hairline-soft border, tertiary affordance.
 * - `destructive`: critical-strong fill.
 * - `link`: inline text link, cobalt.
 * - `pill-tab` / `pill-tab-active`: category-nav chip.
 */
const buttonVariants = cva(
  [
    // Layout + typography (matches `text-button-md`: 14px / 700 / -0.14px)
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap cursor-pointer",
    "rounded-full font-bold text-button-md",
    "transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-out",
    // Focus
    "outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    // Disabled + invalid ring (filled variants have no border to colour)
    "disabled:pointer-events-none aria-invalid:ring-critical-strong/40",
    // SVG sizing
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-cobalt text-on-cobalt hover:bg-cobalt-deep active:bg-cobalt-deep disabled:bg-disabled-text disabled:text-canvas",
        marketing:
          "bg-ink-button text-on-ink-button hover:bg-charcoal active:bg-charcoal disabled:bg-disabled-text disabled:text-canvas",
        destructive:
          "bg-critical-strong text-canvas hover:bg-critical focus-visible:ring-critical-strong/40 disabled:bg-critical-strong/70",
        secondary:
          "bg-transparent text-ink-deep border-2 border-ink-deep hover:bg-ink-deep hover:text-canvas aria-invalid:border-critical-strong disabled:border-hairline disabled:text-disabled-text",
        ghost:
          "bg-transparent text-ink-deep border border-hairline-soft hover:bg-surface-soft hover:border-hairline aria-invalid:border-critical-strong disabled:text-disabled-text",
        link:
          "text-cobalt underline-offset-4 hover:text-cobalt-deep hover:underline disabled:text-cobalt/60 disabled:no-underline rounded-sm tracking-normal",
        "pill-tab":
          "bg-canvas text-ink border border-hairline hover:border-ink-deep",
        "pill-tab-active":
          "bg-ink-deep text-canvas border border-transparent",
      },
      size: {
        // 14 px label · 14×30 padding — DESIGN.md `button-primary`/`button-buy-cta`
        default: "h-11 px-[30px] py-[14px] has-[>svg]:px-7",
        sm: "h-9 px-[22px] py-2.5 has-[>svg]:px-5",
        xs: "h-7 px-3 py-1 text-caption-bold gap-1 has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-12 px-9 py-4 text-body-md-bold has-[>svg]:px-7",
        tab: "h-8 px-4 py-1.5",
        icon: "size-11 rounded-full",
        "icon-xs": "size-6 rounded-full [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-full",
        "icon-lg": "size-12 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
