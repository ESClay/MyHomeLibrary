import type { JobHandler } from "./types";

/** How long a rate-limited series lookup waits before the next tick may pick it up again. */
export const RATE_LIMIT_WAIT_MS = 60_000;
/** Slices in a row that make no progress before the job gives up. */
export const MAX_STALLED_SLICES = 3;

export type SeriesLookupCursor = { started?: boolean; lastRemaining?: number; stalled?: number; slices?: number };

/** The slice of series-sync.ts the handler uses, so tests can run it against fakes. */
export type SeriesLookupDeps = {
  sync(
    libraryId: string,
    opts: { budgetMs: number; now: () => number; onChange: (c: import("./types").BookChange[]) => Promise<void> },
  ): Promise<{ linkedBooks: number; syncedSeries: number; remaining: number; rateLimited: boolean; unconfigured?: string; errors: string[] }>;
  /** Work in front of the job (see countSeriesWork). */
  countWork(libraryId: string): Promise<number>;
  /** Books this job has recorded changes for. */
  countChangedBooks(jobId: string): Promise<number>;
};

type Totals = { linkedBooks: number; syncedSeries: number; errors: string[] };

/**
 * The series_lookup handler: one slice is one resumable pass of syncLibrarySeries within the slice's time. The pass is
 * idempotent (books are stamped when checked, series when synced), so the "cursor" only carries bookkeeping; the
 * database stamps are what really resume it. Progress is total minus what the pass says is still waiting.
 */
export function seriesLookupHandler(deps: SeriesLookupDeps): JobHandler {
  return async ({ job, deadline, now, recordChanges }) => {
    const cursor = (job.cursor ?? {}) as SeriesLookupCursor;
    const prev = job.summary as Partial<Totals>;
    let total = job.total;
    if (!cursor.started) total = await deps.countWork(job.libraryId);

    const res = await deps.sync(job.libraryId, { budgetMs: Math.max(1_000, deadline - now()), now, onChange: recordChanges });
    if (res.unconfigured) return { state: "failed", error: "Series lookup is not set up on this server (no Hardcover token or service role)." };

    total = Math.max(total, res.remaining);
    const processed = Math.max(0, total - res.remaining);
    const totals: Totals = {
      linkedBooks: (prev.linkedBooks ?? 0) + res.linkedBooks,
      syncedSeries: (prev.syncedSeries ?? 0) + res.syncedSeries,
      errors: [...(prev.errors ?? []), ...res.errors].slice(-5),
    };

    const progressed = cursor.lastRemaining === undefined || res.remaining < cursor.lastRemaining;
    const stalled = progressed ? 0 : (cursor.stalled ?? 0) + 1;
    const next: SeriesLookupCursor = { started: true, lastRemaining: res.remaining, stalled, slices: (cursor.slices ?? 0) + 1 };

    if (res.remaining === 0 && !res.rateLimited) {
      const changedBooks = await deps.countChangedBooks(job.id);
      return { state: "done", total, processed: total, summary: { ...totals, changedBooks } };
    }
    if (res.rateLimited) return { state: "wait", notBefore: now() + RATE_LIMIT_WAIT_MS, total, processed, cursor: next, summary: totals };
    if (stalled >= MAX_STALLED_SLICES) {
      const changedBooks = await deps.countChangedBooks(job.id);
      return { state: "failed", error: totals.errors.at(-1) ?? "Hardcover did not answer for some books. Run it again later.", summary: { ...totals, changedBooks } };
    }
    return { state: "continue", total, processed, cursor: next, summary: totals };
  };
}
