import type { Job } from "./types";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function jobTitle(job: Pick<Job, "kind">): string {
  return job.kind === "series_lookup" ? "Series lookup" : "Photo batch";
}

/** A one-line result for a finished job, e.g. "87 books got a series". */
export function jobSummaryLine(job: Pick<Job, "kind" | "status" | "summary" | "error">): string {
  if (job.status === "failed") return job.error ?? "It stopped before finishing.";
  if (job.status === "cancelled") return "Cancelled.";
  if (job.kind === "series_lookup") {
    const changed = Number(job.summary.changedBooks ?? 0);
    return changed === 0 ? "Nothing needed changing." : `${plural(changed, "book")} updated.`;
  }
  const ready = Number(job.summary.ready ?? 0);
  const failed = Number(job.summary.failed ?? 0);
  const parts = [`${plural(ready, "photo")} ready to review`, ...(failed > 0 ? [`${failed} could not be read`] : [])];
  return `${parts.join(", ")}.`;
}

/** Where a finished job's review lives. */
export function jobReviewHref(job: Pick<Job, "id" | "kind">): string {
  return job.kind === "photo_scan" ? `/add/photo?batch=${job.id}` : `/activity?job=${job.id}`;
}

/** The label of the link to a finished job's review, or null when there is nothing to review. */
export function jobReviewLabel(job: Pick<Job, "kind" | "status" | "summary">): string | null {
  if (job.status === "cancelled") return null;
  if (job.kind === "photo_scan") {
    const ready = Number(job.summary.ready ?? 0);
    return ready > 0 ? `Review ${plural(ready, "photo")}` : null;
  }
  return Number(job.summary.changedBooks ?? 0) > 0 ? "Review changes" : null;
}

/** The text of the notice shown after a job finishes. */
export function jobNoticeText(job: Pick<Job, "kind" | "status" | "summary" | "error">): string {
  if (job.status === "failed") return `${jobTitle(job)} stopped: ${job.error ?? "it could not finish"}.`;
  if (job.kind === "series_lookup") {
    const changed = Number(job.summary.changedBooks ?? 0);
    return changed === 0 ? "Series lookup finished. Nothing needed changing." : `Series lookup finished: ${plural(changed, "book")} updated.`;
  }
  const ready = Number(job.summary.ready ?? 0);
  const failed = Number(job.summary.failed ?? 0);
  if (ready === 0) return failed > 0 ? "Your photos could not be read." : "Your photos are done. Nothing was left to review.";
  return `${plural(ready, "photo")} ready to review${failed > 0 ? `, ${failed} could not be read` : ""}.`;
}

export function jobProgressLine(job: Pick<Job, "kind" | "status" | "total" | "processed" | "summary">): string {
  if (job.status === "queued") return "Waiting to start";
  if (job.kind === "series_lookup") return job.total > 0 ? `Looking up series: ${Math.min(job.processed, job.total)} of ${job.total} checked` : "Looking up series";
  if (job.summary.capWait === true) return `${job.processed} of ${job.total} photos read. The rest are waiting for tomorrow's allowance.`;
  return job.total > 0 ? `Reading photos: ${Math.min(job.processed, job.total)} of ${job.total} read` : "Reading photos";
}
