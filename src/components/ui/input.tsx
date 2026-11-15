import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1 text-base text-foreground shadow-[inset_0_1px_2px_rgb(40_25_10/0.06)] transition-[border-color,box-shadow] duration-[var(--dur-fast)] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 hover:border-foreground/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25",
        className
      )}
      {...props}
    />
  )
}

export { Input }
