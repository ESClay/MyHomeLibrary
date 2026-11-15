"use client";

import { useState } from "react";

/** Plain-text description, clamped to a few lines with a toggle. */
export function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320;
  return (
    <div className="flex flex-col items-start gap-2">
      <p className={`max-w-prose whitespace-pre-line text-base leading-relaxed ${long && !open ? "line-clamp-5" : ""}`}>{text}</p>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-11 cursor-pointer items-center text-sm font-semibold underline decoration-gilt decoration-2 underline-offset-4 hover:decoration-foreground"
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
