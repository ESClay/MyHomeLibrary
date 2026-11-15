"use client";

import { useRef } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

function StarGlyph({ fill, size }: { fill: 0 | 0.5 | 1; size: number }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden>
      <Star className="absolute inset-0 text-border" style={{ width: size, height: size }} strokeWidth={1.5} />
      {fill > 0 && (
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: fill === 1 ? size : size / 2 }}>
          <Star className="fill-gilt text-gilt" style={{ width: size, height: size }} strokeWidth={1.5} />
        </span>
      )}
    </span>
  );
}

function fillFor(value: number, i: number): 0 | 0.5 | 1 {
  return value >= i + 1 ? 1 : value >= i + 0.5 ? 0.5 : 0;
}

/** Read-only stars with half steps. Includes a text alternative. */
export function Stars({ value, size = 16, label }: { value: number | null; size?: number; label?: string }) {
  const v = value ?? 0;
  return (
    <span
      role="img"
      aria-label={label ?? (value === null ? "Not rated" : `${value} out of 5 stars`)}
      className="inline-flex items-center gap-0.5"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <StarGlyph key={i} fill={fillFor(v, i)} size={size} />
      ))}
    </span>
  );
}

/**
 * Half-star input: ten tap zones over five stars. Left half = x.5, right half = x.0.
 * Arrow keys step by half a star; tapping the current value clears it.
 */
export function StarRating({
  value,
  onChange,
  disabled,
  label = "Your rating",
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const v = value ?? 0;

  function onKey(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(5, v + 0.5));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(v - 0.5 < 0.5 ? null : v - 0.5);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      onChange(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <div
        ref={group}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={v}
        aria-valuetext={value === null ? "Not rated" : `${value} out of 5 stars`}
        aria-disabled={disabled}
        onKeyDown={onKey}
        className="relative inline-flex rounded-md"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="relative inline-flex h-11 w-11 items-center justify-center">
            <StarGlyph fill={fillFor(v, i)} size={28} />
            {[0.5, 1].map((step) => {
              const next = i + step;
              return (
                <button
                  key={step}
                  type="button"
                  tabIndex={-1}
                  disabled={disabled}
                  aria-label={`${next} ${next === 1 ? "star" : "stars"}`}
                  onClick={() => onChange(value === next ? null : next)}
                  className={cn(
                    "absolute inset-y-0 w-1/2 cursor-pointer rounded-sm outline-none focus-visible:bg-ring/15 disabled:cursor-not-allowed",
                    step === 0.5 ? "left-0" : "right-0",
                  )}
                />
              );
            })}
          </span>
        ))}
      </div>
      <span className="min-w-[5.5rem] text-sm text-muted-foreground tabular-nums" aria-hidden>
        {value === null ? "Not rated" : `${value.toFixed(1)} of 5`}
      </span>
    </div>
  );
}
