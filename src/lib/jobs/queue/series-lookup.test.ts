import { describe, expect, it, vi } from "vitest";
import { MAX_STALLED_SLICES, RATE_LIMIT_WAIT_MS, seriesLookupHandler, type SeriesLookupDeps } from "./series-lookup";
import type { Job, SliceContext } from "./types";

const baseJob = (over: Partial<Job> = {}): Job => ({
  id: "j1", libraryId: "L1", userId: "u", kind: "series_lookup", status: "running", total: 0, processed: 0, cursor: null, summary: {}, error: null,
  notBefore: null, lockedUntil: null, lockedBy: "r", createdAt: "", startedAt: null, finishedAt: null, seenAt: null, ...over,
});
const ctx = (job: Job, recordChanges = vi.fn(async () => undefined)): SliceContext => ({ job, deadline: 1_045_000, now: () => 1_000_000, recordChanges });
const syncResult = (over = {}) => ({ linkedBooks: 0, syncedSeries: 0, remaining: 0, rateLimited: false, errors: [] as string[], ...over });

function deps(over: Partial<SeriesLookupDeps> = {}): SeriesLookupDeps & { sync: ReturnType<typeof vi.fn> } {
  return { sync: vi.fn(async () => syncResult()), countWork: vi.fn(async () => 10), countChangedBooks: vi.fn(async () => 0), ...over } as never;
}

describe("series_lookup handler", () => {
  it("sizes the job on its first slice, runs the sync within the slice time, and hands the change log to the store", async () => {
    const d = deps({ sync: vi.fn(async (_id, o) => (await o.onChange([{ bookId: "b1", before: { series_id: null }, after: { series_id: "s1" } }]), syncResult({ linkedBooks: 1, remaining: 6 }))) as never });
    const record = vi.fn(async () => undefined);
    const out = await seriesLookupHandler(d)(ctx(baseJob(), record));
    expect(d.countWork).toHaveBeenCalledTimes(1);
    expect(d.sync).toHaveBeenCalledWith("L1", expect.objectContaining({ budgetMs: 45_000 }));
    expect(record).toHaveBeenCalledWith([{ bookId: "b1", before: { series_id: null }, after: { series_id: "s1" } }]);
    expect(out).toMatchObject({ state: "continue", total: 10, processed: 4, summary: { linkedBooks: 1 } });
  });

  it("does not recount on later slices and adds up the totals", async () => {
    const d = deps({ sync: vi.fn(async () => syncResult({ linkedBooks: 2, remaining: 3 })) as never });
    const out = await seriesLookupHandler(d)(ctx(baseJob({ total: 10, processed: 4, cursor: { started: true, lastRemaining: 6, stalled: 0 }, summary: { linkedBooks: 1, syncedSeries: 0, errors: [] } })));
    expect(d.countWork).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: "continue", processed: 7, summary: { linkedBooks: 3 } });
  });

  it("finishes with the number of changed books when nothing is left", async () => {
    const d = deps({ countChangedBooks: vi.fn(async () => 87) });
    const out = await seriesLookupHandler(d)(ctx(baseJob()));
    expect(out).toMatchObject({ state: "done", processed: 10, total: 10, summary: { changedBooks: 87 } });
  });

  it("waits on a rate limit, keeping progress", async () => {
    const d = deps({ sync: vi.fn(async () => syncResult({ rateLimited: true, remaining: 8 })) as never });
    const out = await seriesLookupHandler(d)(ctx(baseJob()));
    expect(out).toMatchObject({ state: "wait", notBefore: 1_000_000 + RATE_LIMIT_WAIT_MS, processed: 2, total: 10 });
  });

  it("gives up after slices that make no progress", async () => {
    const d = deps({ sync: vi.fn(async () => syncResult({ remaining: 5, errors: ["book series: failed"] })) as never });
    let job = baseJob({ total: 10, cursor: { started: true, lastRemaining: 5, stalled: MAX_STALLED_SLICES - 1 } });
    const out = await seriesLookupHandler(d)(ctx(job));
    expect(out).toMatchObject({ state: "failed", error: "book series: failed" });
    job = baseJob({ total: 10, cursor: { started: true, lastRemaining: 5, stalled: 0 } });
    expect(await seriesLookupHandler(d)(ctx(job))).toMatchObject({ state: "continue", cursor: { stalled: 1 } });
  });

  it("fails clearly when Hardcover is not configured", async () => {
    const d = deps({ sync: vi.fn(async () => syncResult({ unconfigured: "hardcover" })) as never });
    expect(await seriesLookupHandler(d)(ctx(baseJob()))).toMatchObject({ state: "failed" });
  });
});
