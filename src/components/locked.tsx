import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** The one sentence every locked feature shows. Kept in sync with FULL_ACCESS_NEEDED in lib/access.ts (server only). */
export const LOCKED_SENTENCE = "Ask the app admin to turn on full access for your account.";

/**
 * The locked state of a feature: a lock, "Full access needed" and one plain sentence. No upsell, no pricing.
 * `block` is the dashed box used inside a section; `inline` is a compact line beside or under a control.
 */
export function Locked({ variant = "block", className }: { variant?: "block" | "inline"; className?: string }) {
  if (variant === "inline") {
    return (
      <p data-locked className={cn("flex items-start gap-2 text-sm text-muted-foreground", className)}>
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-gilt" strokeWidth={1.75} />
        <span>
          <span className="font-medium text-foreground">Full access needed.</span> {LOCKED_SENTENCE}
        </span>
      </p>
    );
  }
  return (
    <div data-locked className={cn("flex items-start gap-3 rounded-[10px] border border-dashed border-input p-4", className)}>
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Lock className="size-4" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-base leading-snug font-medium">Full access needed</p>
        <p className="text-sm text-muted-foreground">{LOCKED_SENTENCE}</p>
      </div>
    </div>
  );
}
