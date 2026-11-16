import { describe, expect, it, vi } from "vitest";
import { emptySummary, mergeSummary, type JobRow, type RowResult } from "./plan";
import { runImport, type BatchResponse, type RunnerProgress } from "./runner";

const jobRow = (n: number): JobRow => ({
  n,
  action: "add",
  targetBookId: null,
  title: `Book ${n}`,
  authors: [],
  series: null,
  seriesPosition: null,
  isbn13: null,
  description: null,
  publishedDate: null,
  calibreUuid: null,
  status: null,
  finishedAt: null,
});

const all = Array.from({ length: 25 }, (_, i) => jobRow(i + 1));

/** A fake server holding `total` rows and a processed counter, like the real action. */
function fakeServer(opts: { total?: number; processed?: number; failBatches?: number[]; rateLimitBatch?: number; cancelAt?: number } = {}) {
  const total = opts.total ?? all.length;
  let processed = opts.processed ?? 0;
  let summary = emptySummary();
  let calls = 0;
  const seen: number[][] = [];
  return {
    get processed() {
      return processed;
    },
    seen,
    getRows: async (from: number, count: number) => all.slice(from, from + count),
    processBatch: async (from: number, rows: JobRow[]): Promise<BatchResponse> => {
      const call = calls++;
      if (opts.failBatches?.includes(call)) throw new Error("network");
      if (opts.cancelAt !== undefined && processed >= opts.cancelAt) return { ok: false, error: "cancelled", cancelled: true };
      if (from !== processed) return { ok: true, processed, total, status: "running", results: [], summary, rateLimited: false, unenriched: 0 };
      seen.push(rows.map((r) => r.n));
      const results: RowResult[] = rows.map((r) => ({ n: r.n, title: r.title, outcome: "added", enriched: true }));
      summary = mergeSummary(summary, results, 200);
      processed += rows.length;
      return { ok: true, processed, total, status: processed >= total ? "done" : "running", results, summary, rateLimited: opts.rateLimitBatch === call, unenriched: 0 };
    },
  };
}

const start = (processed = 0, summary = emptySummary()) => ({ processed, total: all.length, summary, fallbackSecondsPerRow: 1 });

describe("runImport", () => {
  it("sends the rows in order, ten at a time, and finishes", async () => {
    const server = fakeServer();
    const progress: RunnerProgress[] = [];
    const r = await runImport(start(), server, (p) => progress.push(p), () => false);
    expect(r).toMatchObject({ state: "done", processed: 25 });
    expect(server.seen.map((b) => [b[0], b.length])).toEqual([[1, 10], [11, 10], [21, 5]]);
    expect(progress.at(-1)).toMatchObject({ processed: 25, total: 25, etaSeconds: null });
    expect(r.summary.added).toBe(25);
  });

  it("resumes from the job's processed count without re-sending earlier rows", async () => {
    const server = fakeServer({ processed: 12 });
    const r = await runImport(start(12), server, () => {}, () => false);
    expect(r.state).toBe("done");
    expect(server.seen.flat()[0]).toBe(13);
    expect(server.seen.flat()).toHaveLength(13);
  });

  it("retries a dropped call and then succeeds", async () => {
    const server = fakeServer({ failBatches: [0, 1] });
    const sleeps: number[] = [];
    const r = await runImport(start(), { ...server, sleep: async (ms) => void sleeps.push(ms) }, () => {}, () => false);
    expect(r.state).toBe("done");
    expect(sleeps).toEqual([2000, 5000]);
  });

  it("pauses (job intact) after three failed attempts", async () => {
    const server = fakeServer({ failBatches: [0, 1, 2] });
    const r = await runImport(start(), { ...server, sleep: async () => {} }, () => {}, () => false);
    expect(r).toMatchObject({ state: "paused", processed: 0, error: "network" });
  });

  it("accepts the server's position when a retried batch had already landed", async () => {
    const server = fakeServer({ processed: 10 });
    const r = await runImport(start(0), server, () => {}, () => false);
    expect(r.state).toBe("done");
    expect(server.seen.flat()[0]).toBe(11);
  });

  it("stops between batches when cancelled", async () => {
    const server = fakeServer();
    let batches = 0;
    const r = await runImport(start(), { ...server, processBatch: async (f, rows) => { batches++; return server.processBatch(f, rows); } }, () => {}, () => batches >= 1);
    expect(r).toMatchObject({ state: "cancelled", processed: 10 });
  });

  it("treats a cancelled job on the server as cancelled", async () => {
    const server = fakeServer({ cancelAt: 10 });
    const r = await runImport(start(), server, () => {}, () => false);
    expect(r).toMatchObject({ state: "cancelled", processed: 10 });
  });

  it("waits after a rate limit and keeps going", async () => {
    const server = fakeServer({ rateLimitBatch: 0 });
    const sleep = vi.fn(async () => {});
    const notes: (string | null)[] = [];
    const r = await runImport(start(), { ...server, sleep }, (p) => notes.push(p.waiting), () => false);
    expect(r.state).toBe("done");
    expect(sleep).toHaveBeenCalledWith(30_000);
    expect(notes.some((n) => n?.includes("busy"))).toBe(true);
  });

  it("reports an ETA from the measured pace", async () => {
    const server = fakeServer();
    let t = 0;
    const etas: (number | null)[] = [];
    await runImport(start(), { ...server, now: () => (t += 5000) }, (p) => etas.push(p.etaSeconds), () => false);
    // 5 s per batch of ten: after the first batch 15 rows remain at 0.5 s a row.
    expect(etas[1]).toBe(8);
  });
});
