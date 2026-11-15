import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[4px] border border-transparent px-2 text-[0.6875rem] font-semibold tracking-[0.08em] whitespace-nowrap uppercase transition-colors focus-visible:ring-2 focus-visible:ring-ring [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "border-border bg-accent text-accent-foreground",
        destructive: "border-destructive/40 text-destructive",
        outline: "border-input text-foreground",
        ghost: "text-muted-foreground hover:bg-accent",
        link: "text-foreground underline decoration-gilt underline-offset-4",
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
