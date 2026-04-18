import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/shared/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap cursor-pointer transition-[color,background-color,border-color,box-shadow,opacity,text-decoration-color] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/65 disabled:text-primary-foreground/85",
        destructive:
          "bg-destructive text-primary-foreground hover:bg-destructive/90 disabled:bg-destructive/70 disabled:text-primary-foreground/85 focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border border-border bg-background hover:bg-accent hover:text-accent-foreground disabled:border-border disabled:bg-background disabled:text-muted-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "border border-border bg-secondary text-secondary-foreground hover:border-border-strong hover:bg-accent disabled:border-border disabled:bg-secondary disabled:text-secondary-foreground/75",
        ghost:
          "hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground dark:hover:bg-accent/50",
        link:
          "text-focus underline-offset-4 hover:text-focus/80 hover:underline disabled:text-focus/60 disabled:no-underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
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
