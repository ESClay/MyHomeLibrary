import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent text-[0.9375rem] font-medium whitespace-nowrap transition-[background-color,border-color,color,transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease)] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_-2px_0_rgb(0_0_0/0.22),0_1px_2px_rgb(40_25_10/0.2)] hover:bg-[color-mix(in_oklab,var(--primary),var(--foreground)_14%)] hover:shadow-[inset_0_-2px_0_rgb(0_0_0/0.28),0_3px_8px_-2px_rgb(40_25_10/0.3)]",
        outline:
          "border-input bg-card text-foreground hover:border-foreground/40 hover:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-accent",
        destructive:
          "border-destructive/40 bg-transparent text-destructive hover:border-destructive hover:bg-destructive/10",
        link: "h-auto! rounded-none p-0! text-foreground underline decoration-gilt decoration-2 underline-offset-4 hover:decoration-foreground",
      },
      size: {
        default: "h-11 px-4",
        xs: "h-8 gap-1 rounded-md px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 gap-1.5 rounded-md px-3 text-sm [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 px-5 text-base",
        icon: "size-11",
        "icon-xs": "size-8 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-md",
        "icon-lg": "size-12",
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
