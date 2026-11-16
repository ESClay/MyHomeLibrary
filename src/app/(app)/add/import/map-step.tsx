"use client";

import { useMemo } from "react";
import { Field } from "@/components/book-forms";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { STATUS_LABEL } from "@/lib/books/constants";
import { applyMapping, CHOICES, CHOICE_LABEL, defaultValueMap, distinctValues } from "@/lib/calibre/read-map";
import type { CalibreRow, CustomColumn, ReadChoice, ReadMapping } from "@/lib/calibre/types";

const NONE = "__none";
const MAX_VALUES = 40;
const n = (v: number) => v.toLocaleString("en");

export function MapStep({
  rows,
  columns,
  mapping,
  onChange,
  onBack,
  onNext,
}: {
  rows: CalibreRow[];
  columns: CustomColumn[];
  mapping: ReadMapping;
  onChange: (m: ReadMapping) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const values = useMemo(() => (mapping.statusColumn ? distinctValues(rows, mapping.statusColumn) : []), [rows, mapping.statusColumn]);
  const shown = values.slice(0, MAX_VALUES);

  const tally = useMemo(() => {
    const t = { read: 0, reading: 0, want: 0, dnf: 0, dated: 0 };
    if (!mapping.statusColumn && !mapping.dateColumn) return t;
    for (const r of rows) {
      const o = applyMapping(r, mapping);
      if (o.status) t[o.status]++;
      if (o.finishedAt) t.dated++;
    }
    return t;
  }, [rows, mapping]);

  const pickStatus = (header: string) => {
    if (header === NONE) onChange({ ...mapping, statusColumn: null, valueMap: {} });
    else onChange({ ...mapping, statusColumn: header, valueMap: defaultValueMap(distinctValues(rows, header)) });
  };

  const none = columns.length === 0;

  return (
    <section aria-labelledby="map-h" className="panel rise flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="map-h" className="font-display text-xl leading-snug font-medium">
          Which column says what you have read?
        </h2>
        <p className="text-sm text-muted-foreground">
          {none
            ? "This file has no custom columns, so books are imported without a reading status. To bring that over, tick your read column in Calibre's field list and export again."
            : "Pick the custom column you use for read status. It is saved for you only: other members keep their own status."}
        </p>
      </div>

      {!none && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Read status column">
              {(id) => (
                <NativeSelect id={id} value={mapping.statusColumn ?? NONE} onChange={(e) => pickStatus(e.target.value)}>
                  <option value={NONE}>None: leave status blank</option>
                  {columns.map((c) => (
                    <option key={c.header} value={c.header}>
                      {c.header} ({n(c.filled)} filled)
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Finished date column" hint="Becomes the finish date of a read. No start date is set.">
              {(id) => (
                <NativeSelect id={id} value={mapping.dateColumn ?? NONE} onChange={(e) => onChange({ ...mapping, dateColumn: e.target.value === NONE ? null : e.target.value })}>
                  <option value={NONE}>None</option>
                  {columns.map((c) => (
                    <option key={c.header} value={c.header}>
                      {c.header} ({n(c.filled)} filled)
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>

          {mapping.statusColumn && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">What each value means</h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {shown.map((v) => (
                  <li key={v.key || "__blank"} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                    <div className="flex min-w-0 flex-1 basis-40 flex-col">
                      <span className="truncate text-base font-medium">{v.label}</span>
                      <span className="text-xs text-muted-foreground">{n(v.count)} {v.count === 1 ? "book" : "books"}</span>
                    </div>
                    <div className="w-full sm:w-52">
                      <NativeSelect
                        aria-label={`What ${v.label} means`}
                        value={mapping.valueMap[v.key] ?? "ignore"}
                        onChange={(e) => onChange({ ...mapping, valueMap: { ...mapping.valueMap, [v.key]: e.target.value as ReadChoice } })}
                      >
                        {CHOICES.map((c) => (
                          <option key={c} value={c}>
                            {CHOICE_LABEL[c]}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  </li>
                ))}
              </ul>
              {values.length > shown.length && (
                <p className="text-sm text-muted-foreground">
                  This column has {n(values.length)} different values and only the {MAX_VALUES} most common are listed. The rest are left blank. If this is a date column, choose it as the finished date instead.
                </p>
              )}
            </div>
          )}

          <p role="status" className="text-sm text-muted-foreground">
            {mapping.statusColumn || mapping.dateColumn
              ? `${(["read", "reading", "want", "dnf"] as const)
                  .filter((s) => tally[s] > 0)
                  .map((s) => `${n(tally[s])} ${STATUS_LABEL[s].toLowerCase()}`)
                  .join(", ") || "No books get a status"}${tally.dated ? `, ${n(tally.dated)} with a finish date` : ""}.`
              : "No reading status will be set."}
          </p>
        </>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="button" size="lg" onClick={onNext}>
          Continue to review
        </Button>
      </div>
    </section>
  );
}
