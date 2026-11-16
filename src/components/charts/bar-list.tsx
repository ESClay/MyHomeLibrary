import { cn } from "@/lib/utils";

export type BarRow = { key: string; label: string; value: number; display: string; sub?: string; color?: string };

/**
 * Ranked horizontal bars: a label and its figure on one line, the bar under it, so long names never fight the bar for width on a phone.
 * One hue; bars grow from one baseline, are 12px thick with a 4px rounded end, and sit on a lighter step of the same ramp.
 * Sorted by the caller. The figure is printed at the bar's end, so no axis is needed.
 */
export function BarList({ rows, ariaLabel, empty = "Nothing to show yet." }: { rows: BarRow[]; ariaLabel: string; empty?: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul aria-label={ariaLabel} className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">{r.display}</span>
          </div>
          <div className="h-3 w-full rounded-r-[4px] bg-secondary" aria-hidden>
            <div className={cn("h-full rounded-r-[4px]")} style={{ width: `${max > 0 ? Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100) : 0}%`, background: r.color ?? "var(--cloth)" }} />
          </div>
          {r.sub && <span className="text-xs text-muted-foreground">{r.sub}</span>}
        </li>
      ))}
    </ul>
  );
}
