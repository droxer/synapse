import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/shared/lib/utils"

/**
 * DESIGN.md badge variants — all pill-shaped, caption-bold (12px / 700 / 1.33).
 *
 * - `default` / `success`: green chip — "In stock", "Verified".
 * - `promo-yellow`: warning yellow on ink-deep — "Limited time", "Sale".
 * - `attention`: amber on canvas — "Almost gone", "Selling fast".
 * - `critical`: red — "Out of stock", validation labels.
 * - `destructive`: critical-strong fill (alias of critical with the stronger hue).
 * - `secondary` / `outline` / `ghost` / `link`: legacy aliases kept for compat.
 */
const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden",
    "rounded-full border border-transparent px-2.5 py-1",
    "text-caption-bold whitespace-nowrap",
    "transition-[color,box-shadow]",
    "focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    "aria-invalid:border-critical-strong aria-invalid:ring-critical-strong/20",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-success text-canvas [a&]:hover:bg-success/90",
        success: "bg-success text-canvas [a&]:hover:bg-success/90",
        "promo-yellow": "bg-warning text-ink-deep [a&]:hover:bg-warning/90",
        attention: "bg-attention text-canvas [a&]:hover:bg-attention/90",
        critical: "bg-critical text-canvas [a&]:hover:bg-critical/90",
        destructive:
          "bg-critical-strong text-canvas focus-visible:ring-critical-strong/40 [a&]:hover:bg-critical",
        secondary: "bg-surface-soft text-ink [a&]:hover:bg-hairline-soft",
        outline:
          "border border-hairline text-ink-deep [a&]:hover:bg-surface-soft",
        ghost: "text-ink [a&]:hover:bg-surface-soft",
        link: "text-cobalt underline-offset-4 [a&]:hover:text-cobalt-deep [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
