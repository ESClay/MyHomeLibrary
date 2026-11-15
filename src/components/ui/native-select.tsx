import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** A native <select> styled like Input. Best on phones: the OS picker, no portal. */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "h-11 w-full min-w-0 cursor-pointer appearance-none rounded-lg border border-input bg-card py-1 pr-9 pl-3 text-base text-foreground shadow-[inset_0_1px_2px_rgb(40_25_10/0.06)] transition-[border-color,box-shadow] duration-[var(--dur-fast)] outline-none hover:border-foreground/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export { NativeSelect };
