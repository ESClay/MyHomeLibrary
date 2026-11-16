"use client";

import { memo, useMemo, useState } from "react";
import { BookCheck, Check, ChevronLeft, ChevronRight, CircleAlert, Search, Sparkles } from "lucide-react";
import { Cover } from "@/components/cover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { STATUS_LABEL } from "@/lib/books/constants";
import {
  classifyRows,
  countRows,
  effectiveAction,
  includeAction,
  type Classification,
  type LibraryIndexBook,
} from "@/lib/calibre/classify";
import { buildJobRows, estimateSeconds, formatDuration, type JobRow } from "@/lib/calibre/plan";
import { applyMapping } from "@/lib/calibre/read-map";
import type { CalibreRow, ImportAction, ReadMapping, RowStatus } from "@/lib/calibre/types";
import { ShelfPicker } from "@/components/shelf-picker";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const n = (v: number) => v.toLocaleString("en");

type Filter = "all" | RowStatus;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "existing", label: "Already in library" },
  { id: "attention", label: "Needs attention" },
];

const ACTION_LABEL: Record<ImportAction, string> = {
  skip: "Skip this book",
  copy: "Add an e-book copy to my book",
  add: "Add as a separate book",
};

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Tick({ checked, disabled, onChange, label }: { checked: boolean; disabled: boolean; onChange: () => void; label: string }) {
  return (
    <label className={cn("relative flex size-11 shrink-0 items-center justify-center", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} className="peer sr-only" />
      <span className="flex size-6 items-center justify-center rounded-md border border-input bg-card text-primary-foreground transition-[background-color,border-color,transform] duration-[var(--dur-fast)] peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-active:scale-95 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100">
        <Check aria-hidden className="size-4" strokeWidth={3} />
      </span>
    </label>
  );
}

function StatusTag({ c }: { c: Classification }) {
  if (c.status === "existing")
    return (
      <span className="flex items-center gap-1 text-xs font-semibold tracking-[0.08em] text-gilt uppercase">
        <BookCheck aria-hidden className="size-3.5" /> Already in library
      </span>
    );
  if (c.status === "attention")
    return (
      <span className="flex items-center gap-1 text-xs font-semibold tracking-[0.08em] text-destructive uppercase">
        <CircleAlert aria-hidden className="size-3.5" /> Needs attention
      </span>
    );
  return <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">New</span>;
}

type RowProps = {
  index: number;
  row: CalibreRow;
  c: Classification;
  action: ImportAction;
  readLine: string | null;
  onAction: (index: number, action: ImportAction) => void;
};

const Row = memo(function Row({ index, row, c, action, readLine, onAction }: RowProps) {
  const included = action !== "skip";
  const on = c.allowed.find((a) => a !== "skip");
  const author = row.authors.join(", ");
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-4 sm:px-4">
      <div className="flex min-w-0 flex-1 gap-1">
        <Tick
          checked={included}
          disabled={!on}
          onChange={() => onAction(index, included ? "skip" : (on ?? "skip"))}
          label={`${included ? "Skip" : "Include"} ${row.title || `row ${row.n}`}`}
        />
        <Cover url={null} title={row.title || "Untitled"} author={author} className="w-10 shrink-0 self-start" />
        <div className="ml-2 flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-display line-clamp-2 text-base leading-snug font-medium">{row.title || "No title"}</p>
          <p className="truncate text-sm text-muted-foreground">{author || "No author"}</p>
          {row.series && (
            <p className="truncate text-xs text-muted-foreground">
              {row.series}
              {row.seriesPosition !== null ? ` #${row.seriesPosition}` : ""}
            </p>
          )}
          <p className="truncate text-xs text-muted-foreground">
            Row {n(row.n)}
            {row.formats.length > 0 && ` · ${row.formats.join(", ")}`}
            {row.isbn13 && ` · ${row.isbn13}`}
          </p>
          {readLine && <p className="text-xs font-medium">{readLine}</p>}
          {c.reason && <p className={cn("text-xs", c.status === "attention" ? "text-destructive" : "text-muted-foreground")}>{c.reason}</p>}
          {c.match && c.status === "existing" && <p className="truncate text-xs text-muted-foreground">Matches &ldquo;{c.match.title}&rdquo;</p>}
          {row.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 pl-12 sm:w-60 sm:shrink-0 sm:pl-0">
        <StatusTag c={c} />
        {c.status === "existing" ? (
          <NativeSelect aria-label={`What to do with ${row.title}`} value={action} onChange={(e) => onAction(index, e.target.value as ImportAction)}>
            {c.allowed.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </div>
    </li>
  );
});

export function ReviewStep({
  rows,
  index,
  indexError,
  mapping,
  overrides,
  setOverrides,
  enrich,
  setEnrich,
  libraryId,
  shelfIds,
  setShelfIds,
  onBack,
  onStart,
  onRetryIndex,
}: {
  rows: CalibreRow[];
  /** The library's books, or null while they load. */
  index: LibraryIndexBook[] | null;
  indexError: string | null;
  mapping: ReadMapping;
  overrides: Map<number, ImportAction>;
  setOverrides: (next: Map<number, ImportAction>) => void;
  enrich: boolean;
  setEnrich: (v: boolean) => void;
  libraryId: string;
  shelfIds: string[];
  setShelfIds: (ids: string[]) => void;
  onBack: () => void;
  onStart: (rows: JobRow[], skippedInReview: number) => void;
  onRetryIndex: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const classes = useMemo(() => (index ? classifyRows(rows, index) : null), [rows, index]);
  const haystack = useMemo(() => rows.map((r) => `${r.title} ${r.authors.join(" ")} ${r.series ?? ""} ${r.isbn13 ?? ""}`.toLowerCase()), [rows]);
  const counts = useMemo(() => (classes ? countRows(classes, overrides) : null), [classes, overrides]);

  const visible = useMemo(() => {
    if (!classes) return [];
    const q = query.trim().toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (filter !== "all" && classes[i].status !== filter) continue;
      if (q && !haystack[i].includes(q)) continue;
      out.push(i);
    }
    return out;
  }, [classes, rows.length, filter, query, haystack]);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const slice = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const setAction = useMemo(
    () => (i: number, a: ImportAction) => {
      const next = new Map(overrides);
      next.set(i, a);
      setOverrides(next);
    },
    [overrides, setOverrides],
  );

  function selectShown(all: boolean) {
    if (!classes) return;
    const next = new Map(overrides);
    for (const i of visible) next.set(i, all ? includeAction(classes[i]) : "skip");
    setOverrides(next);
  }

  if (indexError) {
    return (
      <section className="panel flex flex-col gap-3 p-5" aria-labelledby="review-h">
        <h2 id="review-h" className="font-display text-xl font-medium">
          Review
        </h2>
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {indexError}
        </p>
        <div className="flex gap-2">
          <Button type="button" onClick={onRetryIndex}>
            Try again
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      </section>
    );
  }

  if (!classes || !counts) {
    return (
      <section className="panel flex flex-col gap-2 p-5" aria-labelledby="review-h">
        <h2 id="review-h" className="font-display text-xl font-medium">
          Review
        </h2>
        <p role="status" className="text-sm text-muted-foreground">
          Checking {n(rows.length)} books against your library…
        </p>
      </section>
    );
  }

  const todo = counts.toAdd + counts.toCopy;
  const tileCount: Record<Filter, number> = { all: counts.total, new: counts.new, existing: counts.existing, attention: counts.attention };
  const secondsOn = estimateSeconds(counts.toAdd, counts.toCopy, true);
  const secondsOff = estimateSeconds(counts.toAdd, counts.toCopy, false);

  function start() {
    const entries = rows.map((row, i) => ({ row, classification: classes![i], override: overrides.get(i) }));
    onStart(buildJobRows(entries, mapping), counts!.skipped);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rise flex flex-col gap-1">
        <h2 id="review-h" className="font-display text-xl leading-snug font-medium">
          Review {n(counts.total)} books
        </h2>
        <p className="text-sm text-muted-foreground">
          Books you already have are marked, and by default get an e-book copy added. Nothing is saved until you press the button at the bottom.
        </p>
      </div>

      <div role="group" aria-label="Filter by status" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => {
              setFilter(f.id);
              setPage(0);
            }}
            className={cn(
              "flex min-h-14 cursor-pointer flex-col items-start justify-center rounded-lg border px-3 py-2 text-left transition-[border-color,background-color,transform] duration-[var(--dur-fast)] hover:-translate-y-0.5 active:translate-y-px",
              filter === f.id ? "border-primary bg-card shadow-[var(--shadow-card)]" : "border-border bg-card/60 hover:border-foreground/30",
            )}
          >
            <span className="font-display text-xl leading-none font-medium tabular-nums">{n(tileCount[f.id])}</span>
            <span className="text-xs text-muted-foreground">{f.label}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search this catalog"
            placeholder="Search title, author, series or ISBN"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            className="pl-9"
            autoComplete="off"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => selectShown(true)} disabled={visible.length === 0}>
            Select all
          </Button>
          <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => selectShown(false)} disabled={visible.length === 0}>
            Select none
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground" aria-live="polite">
        {filter === "all" && !query ? "Select all and none apply to every book." : `Select all and none apply to the ${n(visible.length)} ${visible.length === 1 ? "book" : "books"} shown.`}
      </p>

      {visible.length === 0 ? (
        <p role="status" className="panel p-5 text-sm text-muted-foreground">
          No books match.
        </p>
      ) : (
        <ul className="panel flex flex-col divide-y divide-border" aria-label={`Books ${safePage * PAGE_SIZE + 1} to ${safePage * PAGE_SIZE + slice.length} of ${n(visible.length)}`}>
          {slice.map((i) => {
            const read = mapping.statusColumn || mapping.dateColumn ? applyMapping(rows[i], mapping) : null;
            const readLine = read?.status ? `${STATUS_LABEL[read.status]}${read.finishedAt ? ` on ${fmtDate(read.finishedAt)}` : ""}` : null;
            return <Row key={i} index={i} row={rows[i]} c={classes[i]} action={effectiveAction(classes[i], overrides.get(i))} readLine={readLine} onAction={setAction} />;
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            <ChevronLeft aria-hidden /> Previous
          </Button>
          <p className="text-sm text-muted-foreground tabular-nums">
            Page {n(safePage + 1)} of {n(pages)}
          </p>
          <Button type="button" variant="outline" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>
            Next <ChevronRight aria-hidden />
          </Button>
        </nav>
      )}

      <section className="panel p-4">
        <ShelfPicker libraryId={libraryId} value={shelfIds} onChange={setShelfIds} />
      </section>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-3 shadow-[var(--shadow-card)] md:bottom-4">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} />
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 font-medium">
              <Sparkles aria-hidden className="size-3.5 text-gilt" /> Fill in covers and missing details
            </span>
            <span className="text-muted-foreground">
              {enrich
                ? `Looks each new book up online, at about one a second. This import takes ${formatDuration(secondsOn)}.`
                : `Saves only what Calibre has, with no covers. This import takes ${formatDuration(secondsOff)}.`}
            </span>
          </span>
        </label>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {n(counts.toAdd)} to add{counts.toCopy ? `, ${n(counts.toCopy)} extra e-book ${counts.toCopy === 1 ? "copy" : "copies"}` : ""}, {n(counts.skipped)} skipped.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button type="button" size="lg" disabled={todo === 0} onClick={start}>
            {todo === 0 ? "Nothing to import" : `Import ${n(todo)} ${todo === 1 ? "book" : "books"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
