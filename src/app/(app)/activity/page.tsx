import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, PageHeader, SpineRow } from "@/components/shelf";
import { canEdit as roleCanEdit } from "@/lib/books/access";
import { jobProgressLine, jobReviewHref, jobReviewLabel, jobSummaryLine, jobTitle } from "@/lib/jobs/queue/describe";
import { loadJob, loadLibraryJobs, loadSeriesReview } from "@/lib/jobs/queue/queries";
import type { Job } from "@/lib/jobs/queue/types";
import { getLibraryContext } from "@/lib/library";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { CancelJobButton, MarkSeen, RunJobsNowButton, UndoButton } from "./activity-controls";

export const metadata: Metadata = { title: "Activity" };

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "";

function ProgressBar({ job }: { job: Job }) {
  const pct = job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={`${jobTitle(job)} progress`}
      aria-valuemin={0}
      aria-valuemax={job.total || 100}
      aria-valuenow={job.total ? Math.min(job.processed, job.total) : undefined}
      className="h-1.5 overflow-hidden rounded-full bg-accent"
    >
      <div className="h-full rounded-full bg-gilt transition-[width] duration-[var(--dur)] ease-[var(--ease)]" style={{ width: `${job.status === "queued" ? 4 : Math.max(pct, 4)}%` }} />
    </div>
  );
}

function RunningJob({ job, canCancel }: { job: Job; canCancel: boolean }) {
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-display text-lg leading-snug font-medium">{jobTitle(job)}</p>
        <ProgressBar job={job} />
        <p className="text-sm text-muted-foreground">{jobProgressLine(job)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {job.kind === "photo_scan" && (
          <Link
            href={jobReviewHref(job)}
            className="inline-flex h-11 shrink-0 items-center rounded-lg px-3 text-[0.9375rem] font-medium underline decoration-gilt decoration-2 underline-offset-4 transition-colors duration-[var(--dur-fast)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
          >
            See each photo
          </Link>
        )}
        {canCancel && <CancelJobButton jobId={job.id} />}
      </div>
    </li>
  );
}

function FinishedJob({ job, selected }: { job: Job; selected: boolean }) {
  const reviewLabel = jobReviewLabel(job);
  return (
    <li className={cn("flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6", selected && "-mx-3 rounded-lg bg-accent/60 px-3")}>
      <div className="flex min-w-0 flex-col">
        <p className="font-display text-lg leading-snug font-medium">{jobTitle(job)}</p>
        <p className="text-sm text-muted-foreground">
          {job.status === "failed" ? "Stopped" : job.status === "cancelled" ? "Cancelled" : "Finished"} {when(job.finishedAt)} · {jobSummaryLine(job)}
        </p>
      </div>
      {reviewLabel && (
        <Link
          href={jobReviewHref(job)}
          className="inline-flex h-11 shrink-0 items-center self-start rounded-lg px-3 text-[0.9375rem] font-medium underline decoration-gilt decoration-2 underline-offset-4 transition-colors duration-[var(--dur-fast)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px sm:self-auto"
        >
          {reviewLabel}
        </Link>
      )}
    </li>
  );
}

const STATE_LABEL = { applied: "Applied", edited: "Edited since", undone: "Undone" } as const;

async function SeriesReview({ job, filter, canUndo }: { job: Job; filter: "all" | "edited"; canUndo: boolean }) {
  const supabase = await createClient();
  const rows = await loadSeriesReview(supabase, job.id);
  const edited = rows.filter((r) => r.state === "edited").length;
  const shown = filter === "edited" ? rows.filter((r) => r.state === "edited") : rows;
  const undoable = rows.filter((r) => r.state !== "undone").length;
  const tab = (id: "all" | "edited", label: string) => (
    <Link
      href={id === "all" ? `/activity?job=${job.id}` : `/activity?job=${job.id}&filter=edited`}
      aria-current={filter === id ? "true" : undefined}
      className={cn(
        "inline-flex h-11 items-center rounded-lg px-3 text-[0.9375rem] font-medium transition-colors duration-[var(--dur-fast)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px",
        filter === id ? "bg-accent text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
    </Link>
  );

  return (
    <section className="rise panel flex flex-col gap-4 p-5 md:p-8" aria-labelledby="review-heading" style={{ ["--i" as string]: 2 }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-prose flex-col gap-1">
          <h2 id="review-heading" className="text-2xl leading-tight font-medium">
            Series review
          </h2>
          <p className="text-base text-muted-foreground">
            {rows.length} book{rows.length === 1 ? "" : "s"} changed on {when(job.finishedAt)}. Undo puts back only what you have not edited since.
          </p>
        </div>
        {canUndo && undoable > 0 && <UndoButton jobId={job.id} count={undoable} />}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter changes">
        {tab("all", `All ${rows.length}`)}
        {tab("edited", `Edited since ${edited}`)}
      </div>
      {shown.length === 0 ? (
        <p className="text-base text-muted-foreground">{filter === "edited" ? "No book has been edited since." : "No changes were recorded."}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {shown.map((r) => (
            <li key={r.bookId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link href={`/books/${r.bookId}`} className="font-display text-lg leading-snug font-medium text-pretty underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  {r.title}
                </Link>
                {r.author && <p className="text-sm text-muted-foreground">{r.author}</p>}
                <p className="text-sm">
                  <span className="text-muted-foreground line-through decoration-muted-foreground/60">{r.oldText}</span>
                  <span aria-hidden className="px-1.5 text-gilt">
                    →
                  </span>
                  <span className="sr-only"> to </span>
                  <span className="font-medium">{r.newText}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 sm:justify-end">
                <span className="eyebrow text-muted-foreground">{STATE_LABEL[r.state]}</span>
                {canUndo && r.state !== "undone" && <UndoButton jobId={job.id} bookId={r.bookId} title={r.title} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ job?: string; filter?: string }> }) {
  const { user, current } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.
  const sp = await searchParams;
  const supabase = await createClient();
  const { active, finished } = await loadLibraryJobs(supabase, current.id);
  const jobId = z.string().uuid().safeParse(sp.job);
  const reviewed = jobId.success ? await loadJob(supabase, current.id, jobId.data) : null;
  const filter = sp.filter === "edited" ? "edited" : "all";
  const dev = process.env.NODE_ENV !== "production";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <AutoRefresh active={active.length > 0} />
      <PageHeader eyebrow={current.name} title="Activity" lede="Series lookups and photo batches that run in the background, and what they found." />
      {reviewed && reviewed.kind === "series_lookup" && <MarkSeen jobId={reviewed.id} />}

      {active.length > 0 && (
        <section className="rise panel flex flex-col gap-1 p-5 md:p-8" aria-labelledby="running-heading" style={{ ["--i" as string]: 1 }}>
          <h2 id="running-heading" className="text-2xl leading-tight font-medium">
            Running
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {active.map((job) => (
              <RunningJob key={job.id} job={job} canCancel={current.role === "owner" || job.userId === user.id} />
            ))}
          </ul>
        </section>
      )}

      {reviewed && reviewed.kind === "series_lookup" && reviewed.status !== "queued" && reviewed.status !== "running" && (
        <SeriesReview job={reviewed} filter={filter} canUndo={roleCanEdit(current.role)} />
      )}

      {finished.length > 0 ? (
        <section className="rise panel flex flex-col gap-1 p-5 md:p-8" aria-labelledby="finished-heading" style={{ ["--i" as string]: 3 }}>
          <h2 id="finished-heading" className="text-2xl leading-tight font-medium">
            Finished
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {finished.map((job) => (
              <FinishedJob key={job.id} job={job} selected={reviewed?.id === job.id} />
            ))}
          </ul>
        </section>
      ) : (
        active.length === 0 && (
          <EmptyState
            title="Nothing has run yet"
            body="Start Find my series from Discover, or photograph covers, and the work carries on in the background. You can leave the page; a badge here tells you when it is done."
            art={
              <SpineRow
                spines={[
                  { w: 22, h: 70, tone: 1 },
                  { w: 18, h: 56, tone: 3 },
                  { w: 26, h: 82, tone: 2 },
                  { w: 20, h: 64, tone: 5 },
                ]}
                gap={2}
              />
            }
          >
            <Link
              href="/discover"
              className="-ml-3 inline-flex h-11 items-center self-start rounded-lg px-3 text-[0.9375rem] font-medium underline decoration-gilt decoration-2 underline-offset-4 transition-colors duration-[var(--dur-fast)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
            >
              Open Discover
            </Link>
          </EmptyState>
        )
      )}

      {dev && <RunJobsNowButton />}
    </div>
  );
}
