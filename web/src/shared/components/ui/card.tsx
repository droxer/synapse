import * as React from "react"

import { cn } from "@/shared/lib/utils"

/**
 * DESIGN.md card variants:
 * - `product-feature` (default): white, 32px radius, 32px pad, hairline-soft border.
 * - `feature-photo`: 32px radius, no chrome — image fills the surface.
 * - `promo-strip`: ink-deep bg, 32px radius, 64px pad — dark hero blocks.
 * - `icon-feature`: 16px radius, 24px pad — 3/4-up reassurance tiles.
 * - `checkout-summary`: 16px radius, 24px pad, subtle elevation — purchase rail.
 * - `why-buy-tile`: 16px radius, 32×24 pad — marketing benefit tile.
 * - `warranty`: surface-soft bg, 24px radius — promo callout.
 * - `panel` (legacy compat): keeps the prior `surface-panel` chrome for existing call sites.
 */
type CardVariant =
  | "product-feature"
  | "feature-photo"
  | "promo-strip"
  | "icon-feature"
  | "checkout-summary"
  | "why-buy-tile"
  | "warranty"
  | "panel"

const cardVariantClass: Record<CardVariant, string> = {
  "product-feature": "card-product-feature flex flex-col gap-6",
  "feature-photo": "card-feature-photo relative overflow-hidden",
  "promo-strip": "card-promo-strip flex flex-col gap-4",
  "icon-feature": "card-icon-feature flex flex-col gap-4",
  "checkout-summary": "card-checkout-summary flex flex-col gap-4",
  "why-buy-tile": "card-why-buy-tile flex flex-col gap-3",
  "warranty": "card-warranty flex flex-col gap-3",
  /* `panel` is the bridge variant for dense in-app surfaces that haven't moved to a
     photographic card yet. 24px radius, hairline-soft border, canvas fill. */
  "panel": "flex flex-col gap-6 py-6 rounded-xxl border border-hairline-soft bg-canvas text-ink-deep",
}

function Card({
  className,
  variant = "panel",
  ...props
}: React.ComponentProps<"div"> & { variant?: CardVariant }) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      className={cn(
        cardVariantClass[variant],
        "transition-[box-shadow,border-color,transform] duration-200 ease-out",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      // `text-subtitle-lg` role — 18 / 700 / 1.44
      className={cn("text-subtitle-lg text-ink-deep", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      // `text-body-sm` role — 14 / 400 / -0.14px
      className={cn("text-body-sm text-steel", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
