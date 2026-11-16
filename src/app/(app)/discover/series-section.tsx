"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Check, RefreshCw } from "lucide-react";
import { ConfirmSheet } from "@/app/(app)/add/confirm-sheet";
import { Cover } from "@/components/cover";
import { Button } from "@/components/ui/button";
import type { GapEntry, SeriesGap } from "@/lib/discover/gaps";
import { entryToMetadata } from "@/lib/discover/to-book";
import { refreshSeries, wishlistEntry } from "./actions";

const TONES = ["bg-spine-1", "bg-spine-2", "bg-spine-3", "bg-spine-4", "bg-spine-5"] as const;

/** One spine per volume: cloth-coloured when the library has it, a dashed gilt slot when it is missing. */
function SeriesSpines({ volumes }: { volumes: SeriesGap["volumes"] }) {
  return (
    <div aria-hidden className="flex flex-col">
      <div className="flex h-9 items-end gap-[3px] overflow-hidden px-1">
        {volumes.slice(0, 40).map((v, i) =>
          v.have ? (
            <span key={v.entry.id} className={`h-full w-2.5 shrink-0 rounded-t-[2px] shadow-[inset_1px_0_0_rgb(255_255_255/0.2)] ${TONES[i % TONES.length]}`} />
          ) : (
            <span key={v.entry.id} className="h-[78%] w-2.5 shrink-0 rounded-t-[2px] border border-b-0 border-dashed border-gilt" />
          ),
        )}
      </div>
      <div className="shelf-line" />
    </div>
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
        <Cover url={entry.coverUrl} title={entry.title} author={entry.authors[0]} />
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
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={pending || added} onClick={wishlist} aria-label={`Add ${entry.title} to wishlist`}>
              {added ? <Check aria-hidden /> : <BookmarkPlus aria-hidden />}
              {added ? "On wishlist" : "Add to wishlist"}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setOwning(true)} aria-label={`I own ${entry.title}`}>
              I own this
            </Button>
          </div>
        )}
      </div>
      {owning && <ConfirmSheet libraryId={libraryId} candidate={entryToMetadata(entry, gap.series.name)} onClose={() => setOwning(false)} />}
    </li>
  );
}

function SeriesBlock({ gap, libraryId, canEdit, canRefresh }: { gap: SeriesGap; libraryId: string; canEdit: boolean; canRefresh: boolean }) {
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
    <section aria-labelledby={`series-${gap.series.id}`} className="flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`series-${gap.series.id}`} className="font-display text-xl leading-snug font-medium">
            {gap.series.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {gap.pending
              ? "Waiting for the first lookup"
              : gap.missing.length === 0
                ? `Complete: you have all ${gap.total}`
                : `You have ${gap.owned} of ${gap.total}`}
            {gap.series.authorName ? ` · ${gap.series.authorName}` : ""}
          </p>
        </div>
        {canRefresh && (
          <Button type="button" variant="ghost" size="sm" onClick={refresh} disabled={pending} aria-label={`Refresh ${gap.series.name}`}>
            <RefreshCw className={pending ? "animate-spin" : ""} aria-hidden />
            {pending ? "Checking" : "Refresh"}
          </Button>
        )}
      </header>
      {gap.volumes.length > 0 && <SeriesSpines volumes={gap.volumes} />}
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
    </section>
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
  return (
    <div className="flex flex-col gap-8">
      {gaps.map((gap) => (
        <SeriesBlock key={gap.series.id} gap={gap} libraryId={libraryId} canEdit={canEdit} canRefresh={canRefresh} />
      ))}
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
