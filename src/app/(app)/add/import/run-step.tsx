"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RESUME_FETCH, SECONDS_PER_ENRICHED_ROW, SECONDS_PER_PLAIN_ROW, UPLOAD_CHUNK } from "@/lib/calibre/limits";
import { chunk, emptySummary, formatDuration, type ImportSummary, type JobMapping, type JobRow } from "@/lib/calibre/plan";
import { runImport, type RunnerProgress } from "@/lib/calibre/runner";
import { cancelImport, createImportJob, loadImportRows, processImportBatch, uploadImportRows } from "./actions";

export type RunSource =
  | { kind: "fresh"; libraryId: string; rows: JobRow[]; skippedInReview: number; mapping: JobMapping }
  | { kind: "resume"; jobId: string; total: number; processed: number; summary: ImportSummary; enrich: boolean };

type Phase = "preparing" | "running" | "done" | "cancelled" | "paused";
const n = (v: number) => v.toLocaleString("en");

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-secondary/60 px-3 py-2">
      <dd className="font-display text-xl leading-none font-medium tabular-nums">{n(value)}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}

export function RunStep({ source, onAgain }: { source: RunSource; onAgain: () => void }) {
  const total = source.kind === "fresh" ? source.rows.length : source.total;
  const enrich = source.kind === "fresh" ? source.mapping.enrich : source.enrich;
  const [phase, setPhase] = useState<Phase>("preparing");
  const [uploaded, setUploaded] = useState(0);
  const [progress, setProgress] = useState<RunnerProgress>({
    processed: source.kind === "resume" ? source.processed : 0,
    total,
    summary: source.kind === "resume" ? source.summary : emptySummary(source.kind === "fresh" ? source.skippedInReview : 0),
    etaSeconds: null,
    waiting: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [hasJob, setHasJob] = useState(source.kind === "resume");
  const latest = useRef(progress);
  const jobId = useRef<string | null>(source.kind === "resume" ? source.jobId : null);
  const cancelled = useRef(false);
  const started = useRef(false);
  const cache = useRef<{ from: number; rows: JobRow[] }>({ from: -1, rows: [] });

  const drive = useCallback(async () => {
    const id = jobId.current;
    if (!id) return;
    setPhase("running");
    setError(null);
    const getRows = async (from: number, count: number): Promise<JobRow[]> => {
      if (source.kind === "fresh") return source.rows.slice(from, from + count);
      const c = cache.current;
      if (from < c.from || from + count > c.from + c.rows.length) {
        const res = await loadImportRows({ jobId: id, from, count: RESUME_FETCH });
        if (!res.ok) throw new Error(res.error);
        cache.current = { from, rows: res.rows };
      }
      const at = from - cache.current.from;
      return cache.current.rows.slice(at, at + count);
    };
    const show = (p: RunnerProgress) => {
      latest.current = p;
      setProgress(p);
    };
    const result = await runImport(
      { processed: latest.current.processed, total, summary: latest.current.summary, fallbackSecondsPerRow: enrich ? SECONDS_PER_ENRICHED_ROW : SECONDS_PER_PLAIN_ROW },
      { getRows, processBatch: (from, rows) => processImportBatch({ jobId: id, from, rows }) },
      show,
      () => cancelled.current,
    );
    show({ processed: result.processed, total, summary: result.summary, etaSeconds: null, waiting: null });
    if (result.state === "paused") {
      setError(result.error);
      setPhase("paused");
    } else setPhase(result.state);
  }, [source, total, enrich]);

  // Fresh import: create the job, upload the reviewed rows in chunks, then run. A resume goes straight to running.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      if (source.kind === "resume") return drive();
      const created = await createImportJob({
        libraryId: source.libraryId,
        mapping: source.mapping,
        skippedInReview: source.skippedInReview,
      });
      if (!created.ok) {
        setError(created.error);
        setPhase("paused");
        return;
      }
      jobId.current = created.jobId;
      setHasJob(true);
      let sent = 0;
      for (const part of chunk(source.rows, UPLOAD_CHUNK)) {
        let res = await uploadImportRows({ jobId: created.jobId, rows: part }).catch(() => null);
        if (!res || !res.ok) res = await uploadImportRows({ jobId: created.jobId, rows: part }).catch(() => null);
        if (!res || !res.ok) {
          setError(res && !res.ok ? res.error : "The list could not be uploaded. Check your connection and start again.");
          setPhase("paused");
          await cancelImport(created.jobId).catch(() => {});
          return;
        }
        sent += part.length;
        setUploaded(sent);
      }
      await drive();
    })();
  }, [source, drive]);

  async function stop() {
    cancelled.current = true;
    setStopping(true);
    if (jobId.current) await cancelImport(jobId.current).catch(() => {});
  }

  async function retry() {
    cancelled.current = false;
    await drive();
  }

  const { summary } = progress;
  const pct = total ? Math.min(100, (progress.processed / total) * 100) : 0;
  const saved = summary.added + summary.copied;

  if (phase === "preparing") {
    return (
      <section className="panel rise flex flex-col gap-3 p-5 sm:p-6" aria-labelledby="run-h">
        <h2 id="run-h" className="font-display text-xl font-medium">
          Getting your list ready
        </h2>
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Saving the list so the import can carry on after a reload. {n(uploaded)} of {n(total)}.
          </p>
        )}
      </section>
    );
  }

  if (phase === "done" || phase === "cancelled") {
    return (
      <section className="panel rise flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="done-h">
        <div className="flex flex-col gap-1">
          <h2 id="done-h" role="status" className="font-display text-xl leading-snug font-medium">
            {phase === "done" ? `${n(saved)} ${saved === 1 ? "book" : "books"} imported` : `Import stopped after ${n(progress.processed)} of ${n(total)}`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {phase === "done" ? "Your library is up to date with the catalog." : `The ${n(saved)} saved ${saved === 1 ? "book stays" : "books stay"} in your library. Import the file again to add the rest: books already imported are skipped.`}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Count label="New books" value={summary.added} />
          <Count label="E-book copies added" value={summary.copied} />
          <Count label="Skipped" value={summary.skipped + summary.skippedInReview} />
          <Count label="Not saved" value={summary.failed} />
        </dl>
        {enrich && summary.added > 0 && (
          <p className="text-sm text-muted-foreground">
            {n(summary.enriched)} of {n(summary.added)} new books got covers or details from online catalogues.
          </p>
        )}
        <Issues summary={summary} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/library">Open the library</Link>
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={onAgain}>
            Import another file
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel rise flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="run-h">
      <div className="flex flex-col gap-1">
        <h2 id="run-h" className="font-display text-xl leading-snug font-medium">
          {phase === "paused" ? "The import paused" : `Importing ${n(total)} ${total === 1 ? "book" : "books"}`}
        </h2>
        <p className="text-sm text-muted-foreground">
          {phase === "paused"
            ? "Nothing is lost. Books saved so far stay, and the import carries on from where it stopped."
            : "Keep this page open. If you close it, come back to Add, then Import from Calibre, and choose Resume."}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={progress.processed}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-[var(--dur)]" style={{ width: `${pct}%` }} />
        </div>
        <p role="status" aria-live="polite" className="flex flex-wrap justify-between gap-x-4 text-sm tabular-nums">
          <span>
            {n(progress.processed)} of {n(total)}
          </span>
          <span className="text-muted-foreground">
            {phase === "paused" ? "Paused" : stopping ? "Stopping after this batch…" : progress.etaSeconds ? `${formatDuration(progress.etaSeconds)} left` : "Working out the time left…"}
          </span>
        </p>
        {progress.waiting && <p className="text-sm text-muted-foreground">{progress.waiting}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Count label="New books" value={summary.added} />
        <Count label="E-book copies added" value={summary.copied} />
        <Count label="Skipped" value={summary.skipped} />
        <Count label="Not saved" value={summary.failed} />
      </dl>

      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
      <Issues summary={summary} />

      <div className="flex flex-col gap-2 sm:flex-row">
        {phase === "paused" && hasJob && (
          <Button type="button" size="lg" onClick={() => void retry()}>
            Resume the import
          </Button>
        )}
        {phase === "paused" && !hasJob && (
          <Button type="button" size="lg" variant="outline" onClick={onAgain}>
            Start again
          </Button>
        )}
        {hasJob && (
          <Button type="button" size="lg" variant="outline" disabled={stopping} onClick={() => void stop()}>
            {stopping ? "Stopping…" : "Stop the import"}
          </Button>
        )}
      </div>
    </section>
  );
}

function Issues({ summary }: { summary: ImportSummary }) {
  if (summary.issues.length === 0) return null;
  return (
    <details className="rounded-lg border border-border">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
        {n(summary.issues.length)} {summary.issues.length === 1 ? "book needs a look" : "books need a look"}
      </summary>
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto border-t border-border px-3 py-3 text-sm">
        {summary.issues.map((i, k) => (
          <li key={`${i.n}-${k}`} className="flex flex-col">
            <span className="font-medium">
              Row {n(i.n)}
              {i.title ? `: ${i.title}` : ""}
            </span>
            <span className="text-muted-foreground">{i.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
