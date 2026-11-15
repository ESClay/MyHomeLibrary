import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-2.5 text-base text-foreground shadow-[inset_0_1px_2px_rgb(40_25_10/0.06)] transition-[border-color,box-shadow] duration-[var(--dur-fast)] outline-none placeholder:text-muted-foreground/80 hover:border-foreground/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
