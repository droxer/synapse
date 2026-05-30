import * as React from "react"

import { cn } from "@/shared/lib/utils"

/** DESIGN.md text-input contract — matches Input primitive styling. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-hairline bg-canvas px-3 py-2",
        "text-body-md text-ink transition-[color,border-color,box-shadow] outline-none",
        "placeholder:text-stone",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-2 focus-visible:border-fb-blue focus-visible:px-[11px] focus-visible:outline-none",
        "aria-invalid:border-critical-strong aria-invalid:ring-0",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
