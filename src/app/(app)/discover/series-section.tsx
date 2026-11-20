"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Check, ChevronDown, RefreshCw } from "lucide-react";
import { ConfirmSheet } from "@/app/(app)/add/confirm-sheet";
import { Cover } from "@/components/cover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { GapEntry, SeriesGap } from "@/lib/discover/gaps";
import { entryToMetadata } from "@/lib/discover/to-book";
import { SERIES_SORTS, DEFAULT_SERIES_SORT, parseSeriesSort, viewSeries, type SeriesSort } from "@/lib/discover/series-view";
import { AutoRefresh } from "@/components/auto-refresh";
import { cancelJob } from "@/app/(app)/activity/actions";
import { refreshSeries, wishlistEntry } from "./actions";

const TONES = ["bg-spine-1", "bg-spine-2", "bg-spine-3", "bg-spine-4", "bg-spine-5"] as const;

/** One spine per volume: cloth-coloured when the library has it, a dashed gilt slot when it is missing. */
function SeriesSpines({ volumes }: { volumes: SeriesGap["volumes"] }) {
  return (
    <span aria-hidden className="flex flex-col">
      <span className="flex h-9 items-end gap-[3px] overflow-hidden px-1">
        {volumes.slice(0, 40).map((v, i) =>
          v.have ? (
            <span key={v.entry.id} className={`h-full w-2.5 shrink-0 rounded-t-[2px] shadow-[inset_1px_0_0_rgb(255_255_255/0.2)] ${TONES[i % TONES.length]}`} />
          ) : (
            <span key={v.entry.id} className="h-[78%] w-2.5 shrink-0 rounded-t-[2px] border border-b-0 border-dashed border-gilt" />
          ),
        )}
      </span>
      <span className="shelf-line block" />
    </span>
  );
}

const volumeLabel = (n: number | null) => (n === null ? "" : Number.isInteger(n) ? String(n) : String(n));

function GapRow({ gap, entry, libraryId, canEdit, onMessage }: { gap: SeriesGap; entry: GapEntry; libraryId: string; canEdit: boolean; onMessage: (m: string | null) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);
  const [owning, setOwning] = useState(false);
  const year = entry.releaseDate?.slice(0, 4);

  function wishlist() {
    onMessage(null);
    startTransition(async () => {
      const res = await wishlistEntry({ libraryId, entryId: entry.id });
      if (res.ok) {
        setAdded(true);
        router.refresh();
      } else onMessage(res.error);
    });
  }

  return (
    <li className="flex gap-4 py-4">
      <div className="w-14 shrink-0 md:w-16">
        <Cover url={entry.coverUrl} title={entry.title} author={entry.authors[0]} sizes="(min-width: 768px) 64px, 56px" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow text-gilt">Book {volumeLabel(entry.position)}</p>
          <p className="font-display text-lg leading-snug font-medium text-pretty">{entry.title}</p>
          <p className="text-sm text-muted-foreground">
            {[entry.authors[0], year].filter(Boolean).join(" · ")}
          </p>
        </div>
        {canEdit && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            <Button type="button" variant="outline" disabled={pending || added} onClick={wishlist} aria-label={`Add ${entry.title} to wishlist`}>
              {added ? <Check aria-hidden /> : <BookmarkPlus aria-hidden />}
              {added ? "On wishlist" : "Add to wishlist"}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOwning(true)} aria-label={`I own ${entry.title}`}>
              I own this
            </Button>
          </div>
        )}
      </div>
      {owning && <ConfirmSheet libraryId={libraryId} candidate={entryToMetadata(entry, gap.series.name)} onClose={() => setOwning(false)} />}
    </li>
  );
}

function summaryLine(gap: SeriesGap) {
  return gap.pending ? "Waiting for the first lookup" : gap.missing.length === 0 ? `Complete: you have all ${gap.total}` : `You have ${gap.owned} of ${gap.total}`;
}

/**
 * Which series rows are expanded. Kept above the rows and in a module-level set so it survives
 * router.refresh() and a remount of the list (a refresh re-renders the server data under it).
 */
const openSeries = new Set<string>();

/** One series as a single row; opening it shows the missing volumes. */
function SeriesBlock({ gap, libraryId, canEdit, canRefresh, open, onToggle }: { gap: SeriesGap; libraryId: string; canEdit: boolean; canRefresh: boolean; open: boolean; onToggle: (id: string, open: boolean) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    setMessage(null);
    startTransition(async () => {
      const res = await refreshSeries({ libraryId, seriesId: gap.series.id });
      setMessage(res.ok ? res.message : res.error);
      if (res.ok) router.refresh();
    });
  }

  return (
    <li>
      <details className="group/series" open={open} onToggle={(e) => onToggle(gap.series.id, e.currentTarget.open)}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-lg px-1 py-3 outline-none transition-colors duration-[var(--dur-fast)] hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring active:bg-accent [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="flex flex-col">
              <span className="font-display text-lg leading-snug font-medium text-pretty">{gap.series.name}</span>
              <span className="text-sm text-muted-foreground">
                {summaryLine(gap)}
                {gap.series.authorName ? ` · ${gap.series.authorName}` : ""}
              </span>
            </span>
            {gap.volumes.length > 0 && <SeriesSpines volumes={gap.volumes} />}
          </span>
          <ChevronDown aria-hidden className="size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--dur)] ease-[var(--ease)] group-open/series:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="flex flex-col gap-3 px-1 pb-4">
          {canRefresh && (
            <Button type="button" variant="outline" className="self-start" onClick={refresh} disabled={pending} aria-label={`Refresh ${gap.series.name}`}>
              <RefreshCw className={pending ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden />
              {pending ? "Checking" : "Refresh"}
            </Button>
          )}
          {gap.missing.length > 0 && (
            <ol className="divide-y divide-border">
              {gap.missing.map((entry) => (
                <GapRow key={entry.id} gap={gap} entry={entry} libraryId={libraryId} canEdit={canEdit} onMessage={setMessage} />
              ))}
            </ol>
          )}
          <p role="status" aria-live="polite" className="min-h-0 text-sm text-muted-foreground">
            {message}
          </p>
        </div>
      </details>
    </li>
  );
}

export function SeriesSection({
  libraryId,
  gaps,
  canEdit,
  canRefresh,
}: {
  libraryId: string;
  gaps: SeriesGap[];
  canEdit: boolean;
  /** False when series sync is not configured on this server. */
  canRefresh: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SeriesSort>(DEFAULT_SERIES_SORT);
  const [open, setOpen] = useState<Set<string>>(() => new Set(openSeries));
  const filterId = useId();
  const sortId = useId();
  const shown = viewSeries(gaps, query, sort);

  function toggle(id: string, isOpen: boolean) {
    if (isOpen) openSeries.add(id);
    else openSeries.delete(id);
    setOpen((prev) => {
      if (prev.has(id) === isOpen) return prev;
      const next = new Set(prev);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={filterId} className="text-sm font-medium">
            Filter series
          </label>
          <Input id={filterId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Series or author" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={sortId} className="text-sm font-medium">
            Sort by
          </label>
          <NativeSelect id={sortId} value={sort} onChange={(e) => setSort(parseSeriesSort(e.target.value))}>
            {SERIES_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {query.trim() ? `${shown.length} of ${gaps.length} series` : `${gaps.length} series with volumes to find`}
      </p>
      {shown.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {shown.map((gap) => (
            <SeriesBlock key={gap.series.id} gap={gap} libraryId={libraryId} canEdit={canEdit} canRefresh={canRefresh} open={open.has(gap.series.id)} onToggle={toggle} />
          ))}
        </ul>
      ) : (
        <p className="text-base text-muted-foreground">No series match &ldquo;{query.trim()}&rdquo;.</p>
      )}
    </div>
  );
}

/** The "Find my series" button for a library whose books are not filed under series yet. */
export function FindSeriesButton({ libraryId, label = "Find my series" }: { libraryId: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const res = await refreshSeries({ libraryId });
            setMessage(res.ok ? res.message : res.error);
            if (res.ok) router.refresh();
          })
        }
      >
        <RefreshCw className={pending ? "animate-spin" : ""} aria-hidden />
        {pending ? "Looking up your series…" : label}
      </Button>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

/**
 * Shown instead of the Find my series button while a lookup is queued or running: how far it has got, and Cancel.
 * Re-reads the page every 10 seconds while the tab is open, so the count moves without a reload.
 */
export function SeriesJobStatus({ job, canCancel }: { job: { id: string; status: "queued" | "running"; processed: number; total: number }; canCancel: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pct = job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;
  const line = job.status === "queued" ? "Series lookup is waiting to start" : job.total > 0 ? `Looking up series: ${Math.min(job.processed, job.total)} of ${job.total} checked` : "Looking up series";
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-gilt/50 bg-accent/40 p-4" role="status" aria-live="polite">
      <AutoRefresh active />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-base">{line}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-accent" aria-hidden>
            <div className="h-full rounded-full bg-gilt transition-[width] duration-[var(--dur)] ease-[var(--ease)]" style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">You can leave this page. Activity tells you when it is done.</p>
        </div>
        {canCancel && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await cancelJob(job.id);
                if (res.ok) router.refresh();
                else setError(res.error);
              })
            }
          >
            {pending ? "Cancelling…" : "Cancel lookup"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
