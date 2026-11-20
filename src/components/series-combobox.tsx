"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { suggestSeries, type SeriesOption } from "@/lib/books/series-suggest";
import { cn } from "@/lib/utils";

type Row = { key: string; value: string; label: string; kind: "hint" | "mine" | "other" };

/**
 * A text field for a series name with a list of the library's series under it (ARIA combobox). Free text is always
 * allowed: the list only suggests. This book's author's series come first, then the rest; if what was typed differs
 * from an existing series only by case or accents, the first row offers that spelling instead.
 */
export function SeriesCombobox({
  id,
  value,
  onChange,
  author,
  options,
  maxLength = 200,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /** The book's first author, to rank their series first. */
  author: string;
  options: readonly SeriesOption[];
  maxLength?: number;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const { hint, byAuthor, others } = useMemo(() => suggestSeries(value, author, options), [value, author, options]);
  const rows: Row[] = useMemo(
    () => [
      ...(hint ? [{ key: "hint", value: hint, label: `Use “${hint}”?`, kind: "hint" as const }] : []),
      ...byAuthor.map((n) => ({ key: `m:${n}`, value: n, label: n, kind: "mine" as const })),
      ...others.map((n) => ({ key: `o:${n}`, value: n, label: n, kind: "other" as const })),
    ],
    [hint, byAuthor, others],
  );
  const show = open && rows.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;
  const firstAuthor = author.trim();

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (rows.length === 0) return;
      e.preventDefault();
      if (!show) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : rows.length - 1);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i === -1 ? (step === 1 ? 0 : rows.length - 1) : (i + step + rows.length) % rows.length));
    } else if (e.key === "Enter") {
      if (show && active >= 0 && rows[active]) {
        e.preventDefault();
        choose(rows[active].value);
      }
    } else if (e.key === "Escape") {
      if (show) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    }
  }

  const optionClass = (i: number) =>
    cn(
      "flex min-h-11 w-full cursor-pointer items-center px-3 py-2 text-left text-base leading-snug transition-colors duration-[var(--dur-fast)] hover:bg-accent active:bg-accent",
      i === active && "bg-accent text-accent-foreground",
    );
  const renderRow = (r: Row) => {
    const i = rows.indexOf(r);
    return (
      <div
        key={r.key}
        id={optionId(i)}
        role="option"
        aria-selected={i === active}
        // Keep focus in the input so the list does not close before the click lands (works for touch too).
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => choose(r.value)}
        onMouseMove={() => i !== active && setActive(i)}
        className={cn(optionClass(i), r.kind === "hint" && "font-medium")}
      >
        <span className="min-w-0 break-words">{r.label}</span>
      </div>
    );
  };
  const hintRow = rows.find((r) => r.kind === "hint");
  const mine = rows.filter((r) => r.kind === "mine");
  const rest = rows.filter((r) => r.kind === "other");

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show && active >= 0 ? optionId(active) : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      <div
        id={listId}
        role="listbox"
        aria-label="Series in this library"
        hidden={!show}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_12px_32px_-12px_rgb(40_25_10/0.45)]"
      >
        {show && (
          <>
            {hintRow && renderRow(hintRow)}
            {mine.length > 0 && (
              <div role="group" aria-label={firstAuthor ? `By ${firstAuthor}` : "By this author"}>
                <p aria-hidden className="eyebrow px-3 pt-2.5 pb-1 text-gilt">
                  By {firstAuthor}
                </p>
                {mine.map(renderRow)}
              </div>
            )}
            {rest.length > 0 && (
              <div role="group" aria-label={mine.length > 0 || hintRow ? "Other series" : "Series"}>
                {(mine.length > 0 || hintRow) && (
                  <p aria-hidden className="eyebrow border-t border-border px-3 pt-2.5 pb-1 text-muted-foreground">
                    Other series
                  </p>
                )}
                {rest.map(renderRow)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
