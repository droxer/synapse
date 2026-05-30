import * as React from "react"

import { cn } from "@/shared/lib/utils"

/**
 * DESIGN.md `text-input` — 44px tall, `rounded.lg`, 1px `hairline` border.
 * Focus → 2px ring in `focus` color (matches Button focus pattern). Error → 1px `critical-strong`.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Box
        "h-11 w-full min-w-0 rounded-lg border border-hairline bg-canvas px-3 py-2",
        "text-body-md text-ink",
        "transition-[color,border-color,box-shadow] outline-none",
        // Selection + file input
        "selection:bg-cobalt selection:text-on-cobalt",
        "file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-sm file:font-bold file:text-ink",
        // Placeholder
        "placeholder:text-stone",
        // Disabled
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // Focus → 2px ring matching the Button focus pattern (no layout shift)
        "focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-0 focus-visible:border-focus",
        // Invalid
        "aria-invalid:border-critical-strong aria-invalid:ring-2 aria-invalid:ring-critical-strong/30",
        className
      )}
      {...props}
    />
  )
}

export { Input }
