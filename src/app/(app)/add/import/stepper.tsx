import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const STEPS = [
  { id: "export", label: "Export" },
  { id: "upload", label: "Upload" },
  { id: "read", label: "Read status" },
  { id: "review", label: "Review" },
  { id: "run", label: "Import" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

/** Five steps. On a phone only the current label shows, so the row never wraps. */
export function Stepper({ current }: { current: StepId }) {
  const at = STEPS.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Import progress">
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const done = i < at;
          const active = i === at;
          return (
            <li key={s.id} aria-current={active ? "step" : undefined} className={cn("flex items-center gap-2", active ? "min-w-0 flex-1 sm:flex-none" : "shrink-0")}>
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-[var(--dur)]",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-foreground",
                  !done && !active && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : i + 1}
                {done && <span className="sr-only">Done: {s.label}</span>}
              </span>
              <span className={cn("truncate text-sm", active ? "font-semibold" : "hidden text-muted-foreground sm:inline")}>{s.label}</span>
              {i < STEPS.length - 1 && <span aria-hidden className={cn("hidden h-px w-4 sm:block lg:w-8", done ? "bg-primary" : "bg-border")} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
