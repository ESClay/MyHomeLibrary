"use client";

import { useId, useState } from "react";
import { niceTicks } from "@/lib/stats/aggregate";
import { cn } from "@/lib/utils";

export type ChartSeries = { key: string; label: string; color: string; values: number[] };

/**
 * Columns on one baseline, one or two series side by side. HTML and CSS rather than a scaled SVG, so text stays at its real size on a
 * 375px screen. Marks: at most 24px wide, 4px rounded tops, square at the baseline, a 2px gap between neighbours, hairline grid.
 * Hover or focus a column group for a tooltip; the value of the tallest column is printed on it, and a table alternative is the
 * caller's job (see DataTable).
 */
export function ColumnChart({
  categories,
  tickLabels,
  series,
  format,
  ariaLabel,
  height = 176,
}: {
  categories: string[];
  /** Shorter labels for the x axis; defaults to the categories. */
  tickLabels?: string[];
  series: ChartSeries[];
  format: (n: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const labels = tickLabels ?? categories;
  const n = categories.length;
  // Only the tallest column of each series is printed on the chart; the tooltip and the table carry the rest.
  const peak = series.map((s) => (Math.max(...s.values) > 0 ? s.values.indexOf(Math.max(...s.values)) : -1));
  // On a crowded axis, label every other category so labels never touch.
  const step = n > 14 ? 3 : n > 8 ? 2 : 1;

  return (
    <figure className="flex flex-col gap-3" aria-label={ariaLabel}>
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 pt-2">
        <div aria-hidden className="relative w-9 shrink-0 text-right text-[0.6875rem] text-muted-foreground tabular-nums" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 leading-none" style={{ bottom: `${(t / top) * 100}%` }}>
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative border-b border-border" style={{ height }}>
            {ticks.slice(1).map((t) => (
              <div key={t} aria-hidden className="absolute inset-x-0 border-t border-border/70" style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end">
              {categories.map((c, i) => (
                <div
                  key={c}
                  role="group"
                  tabIndex={0}
                  aria-label={`${c}: ${series.map((s) => `${s.label} ${format(s.values[i] ?? 0)}`).join(", ")}`}
                  aria-describedby={active === i ? `${id}-tip` : undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive((a) => (a === i ? null : a))}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                  className={cn("flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 rounded-sm px-[1px] outline-offset-[-2px]", active === i && "bg-accent/50")}
                >
                  {series.map((s, si) => {
                    const v = s.values[i] ?? 0;
                    return (
                      <div key={s.key} className="relative flex h-full max-w-6 min-w-0 flex-1 items-end">
                        {peak[si] === i && (
                          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[0.6875rem] leading-none font-semibold whitespace-nowrap text-foreground tabular-nums" style={{ bottom: `calc(${(v / top) * 100}% + 4px)` }}>
                            {format(v)}
                          </span>
                        )}
                        <div className="w-full rounded-t-[4px]" style={{ height: `${(v / top) * 100}%`, background: s.color, minHeight: v > 0 ? 2 : 0 }} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {active !== null && (
              <div
                id={`${id}-tip`}
                role="tooltip"
                className="pointer-events-none absolute top-0 z-10 flex flex-col gap-0.5 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-[var(--shadow-card)]"
                style={{ left: `${Math.min(80, Math.max(20, ((active + 0.5) / n) * 100))}%`, transform: "translate(-50%, -100%)" }}
              >
                <span className="font-semibold">{categories[active]}</span>
                {series.map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
                    <span aria-hidden className="size-2 rounded-[2px]" style={{ background: s.color }} />
                    {series.length > 1 ? `${s.label} ` : ""}
                    <span className="tabular-nums">{format(s.values[active] ?? 0)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div aria-hidden className="mt-1.5 flex text-[0.6875rem] text-muted-foreground">
            {labels.map((l, i) => (
              <span key={`${l}-${i}`} className="min-w-0 flex-1 truncate text-center">
                {i % step === 0 ? l : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
