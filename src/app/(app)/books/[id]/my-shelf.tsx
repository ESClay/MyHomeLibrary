"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { addRead, deleteRead, saveMyBook, updateRead } from "@/app/(app)/books/actions";
import { Stars, StarRating } from "@/components/stars";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { STATUSES, STATUS_LABEL, type Status } from "@/lib/books/constants";
import type { ReadRow } from "@/lib/books/data";
import { formatDate, timesRead } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MyShelf({
  bookId,
  status,
  rating,
  notes,
  reads,
}: {
  bookId: string;
  status: Status | null;
  rating: number | null;
  notes: string | null;
  reads: ReadRow[];
}) {
  const [, startTransition] = useTransition();
  const [optStatus, setOptStatus] = useOptimistic(status);
  const [optRating, setOptRating] = useOptimistic(rating);
  const [draftNotes, setDraftNotes] = useState(notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finished = reads.filter((r) => r.finished_at).length;
  const notesDirty = draftNotes !== (notes ?? "");

  function run(task: () => Promise<{ ok: boolean; error?: string }>, optimistic?: () => void) {
    setError(null);
    startTransition(async () => {
      optimistic?.();
      const res = await task();
      if (!res.ok) setError(res.error ?? "That did not save.");
    });
  }

  async function saveNotes() {
    setError(null);
    setSavingNotes(true);
    const res = await saveMyBook({ bookId, notes: draftNotes });
    setSavingNotes(false);
    if (res.ok) setNotesSaved(true);
    else setError(res.error);
  }

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Where are you with it?</legend>
        <div role="radiogroup" aria-label="Your reading status" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STATUSES.map((s) => (
            <label key={s} className="cursor-pointer">
              <input
                type="radio"
                name={`status-${bookId}`}
                value={s}
                checked={optStatus === s}
                onChange={() => run(() => saveMyBook({ bookId, status: s }), () => setOptStatus(s))}
                className="peer sr-only"
              />
              <span className="flex h-11 items-center justify-center rounded-lg border border-input bg-card px-2 text-center text-sm font-medium transition-colors duration-[var(--dur-fast)] hover:border-foreground/40 peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                {STATUS_LABEL[s]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Your rating</p>
        <StarRating
          value={optRating}
          onChange={(next) => run(() => saveMyBook({ bookId, rating: next }), () => setOptRating(next))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`notes-${bookId}`}>Your notes</Label>
        <Textarea
          id={`notes-${bookId}`}
          value={draftNotes}
          onChange={(e) => {
            setDraftNotes(e.target.value);
            setNotesSaved(false);
          }}
          rows={4}
          maxLength={10000}
          placeholder="What stayed with you? Everyone in this library can read your notes."
        />
        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" disabled={!notesDirty || savingNotes} onClick={saveNotes}>
            {savingNotes ? "Saving…" : "Save notes"}
          </Button>
          {notesSaved && !notesDirty && (
            <span role="status" className="text-sm text-muted-foreground">
              Saved
            </span>
          )}
        </div>
      </div>

      <ReadsLog bookId={bookId} reads={reads} finished={finished} run={run} />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

type Run = (task: () => Promise<{ ok: boolean; error?: string }>) => void;

function ReadsLog({ bookId, reads, finished, run }: { bookId: string; reads: ReadRow[]; finished: number; run: Run }) {
  const [started, setStarted] = useState("");
  const [finishedAt, setFinishedAt] = useState("");

  return (
    <section aria-labelledby={`reads-${bookId}`} className="flex flex-col gap-3 border-t border-border pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`reads-${bookId}`} className="font-display text-lg font-medium">
          Reads
        </h3>
        {finished > 0 && <p className="text-sm text-muted-foreground">{timesRead(finished)}</p>}
      </div>

      {reads.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {reads.map((r) => (
            <ReadItem key={r.id} read={r} run={run} />
          ))}
        </ul>
      )}

      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addRead({ bookId, read: { startedAt: started, finishedAt } }));
          setStarted("");
          setFinishedAt("");
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`started-${bookId}`}>Started</Label>
          <Input id={`started-${bookId}`} type="date" value={started} onChange={(e) => setStarted(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`finished-${bookId}`}>Finished</Label>
          <Input id={`finished-${bookId}`} type="date" value={finishedAt} onChange={(e) => setFinishedAt(e.target.value)} />
        </div>
        <Button type="submit" variant="outline" disabled={!started && !finishedAt}>
          Log this read
        </Button>
      </form>
    </section>
  );
}

function ReadItem({ read, run }: { read: ReadRow; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [started, setStarted] = useState(read.started_at ?? "");
  const [finished, setFinished] = useState(read.finished_at ?? "");

  if (editing) {
    return (
      <li className="flex flex-col gap-3 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`s-${read.id}`}>Started</Label>
            <Input id={`s-${read.id}`} type="date" value={started} onChange={(e) => setStarted(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`f-${read.id}`}>Finished</Label>
            <Input id={`f-${read.id}`} type="date" value={finished} onChange={(e) => setFinished(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => {
              run(() => updateRead({ readId: read.id, read: { startedAt: started, finishedAt: finished } }));
              setEditing(false);
            }}
          >
            Save dates
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 p-3">
      <p className="min-w-0 flex-1 text-[0.9375rem]">
        {read.started_at ? formatDate(read.started_at) : "Start date unknown"}
        <span className="px-1.5 text-muted-foreground" aria-hidden>
          →
        </span>
        <span className="sr-only"> to </span>
        <span className={cn(!read.finished_at && "text-muted-foreground")}>{read.finished_at ? formatDate(read.finished_at) : "not finished"}</span>
      </p>
      <Button type="button" variant="ghost" size="sm" className="h-11" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Delete this read"
        onClick={() => run(() => deleteRead(read.id))}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

/** A compact read-only line for another member's rating. */
export function OtherRating({ rating }: { rating: number | null }) {
  return rating === null ? <span className="text-sm text-muted-foreground">Not rated</span> : (
    <span className="flex items-center gap-2">
      <Stars value={rating} size={16} />
      <span className="text-sm tabular-nums text-muted-foreground">{rating.toFixed(1)}</span>
    </span>
  );
}
