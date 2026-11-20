import { describe, expect, it, vi } from "vitest";
import type { BookChange, Job, JobHandler, JobKind, JobStore, SliceResult } from "./types";
import { runTick } from "./worker";

/** A fake clock the handlers and the worker share; handlers advance it by the time their slice "takes". */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", libraryId: "L1", userId: "u1", kind: "series_lookup", status: "queued", total: 0, processed: 0, cursor: null, summary: {}, error: null,
  notBefore: null, lockedUntil: null, lockedBy: null, createdAt: "2026-11-20T00:00:00Z", startedAt: null, finishedAt: null, seenAt: null, ...over,
});

/** The same rules as the claim_job SQL function, atomically, over an array. */
function fakeStore(jobs: Job[], now: () => number) {
  const log: string[] = [];
  const changes: { jobId: string; changes: BookChange[] }[] = [];
  const store: JobStore = {
    async claim(runId, kinds: JobKind[], leaseMs) {
      const j = jobs
        .filter((x) => (x.status === "queued" || x.status === "running") && kinds.includes(x.kind))
        .filter((x) => !x.notBefore || Date.parse(x.notBefore) <= now())
        .filter((x) => !x.lockedUntil || Date.parse(x.lockedUntil) < now())
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!j) return null;
      Object.assign(j, { status: "running", lockedBy: runId, lockedUntil: new Date(now() + leaseMs).toISOString(), startedAt: j.startedAt ?? new Date(now()).toISOString() });
      log.push(`claim ${j.id} by ${runId}`);
      return { ...j };
    },
    async saveSlice(j, runId, patch, leaseMs) {
      const row = jobs.find((x) => x.id === j.id)!;
      if (row.status !== "running" || row.lockedBy !== runId) return false;
      Object.assign(row, { ...(patch.total !== undefined ? { total: patch.total } : {}), ...(patch.processed !== undefined ? { processed: patch.processed } : {}), ...(patch.cursor !== undefined ? { cursor: patch.cursor } : {}), ...(patch.summary ? { summary: patch.summary } : {}), lockedUntil: new Date(now() + leaseMs).toISOString() });
      log.push(`save ${j.id} ${row.processed}/${row.total}`);
      return true;
    },
    async release(j, runId, notBefore) {
      const row = jobs.find((x) => x.id === j.id)!;
      if (row.lockedBy !== runId) return;
      Object.assign(row, { lockedBy: null, lockedUntil: null, notBefore: notBefore ? new Date(notBefore).toISOString() : null });
      log.push(`release ${j.id}`);
    },
    async finish(j, runId, o) {
      const row = jobs.find((x) => x.id === j.id)!;
      if (row.lockedBy !== runId || row.status !== "running") return;
      Object.assign(row, { status: o.status, error: o.error ?? null, summary: o.summary ?? row.summary, lockedBy: null, lockedUntil: null, finishedAt: new Date(now()).toISOString() });
      log.push(`finish ${j.id} ${o.status}`);
    },
    async recordChanges(jobId, c) {
      changes.push({ jobId, changes: c });
    },
  };
  return { store, jobs, log, changes };
}

const handlerOf = (fn: JobHandler) => ({ series_lookup: fn });

describe("claiming and leases", () => {
  it("two workers never get the same job", async () => {
    const c = clock();
    const { store } = fakeStore([job()], c.now);
    const [a, b] = await Promise.all([store.claim("run-a", ["series_lookup"], 300_000), store.claim("run-b", ["series_lookup"], 300_000)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("a held lease keeps others off; once it runs out another worker resumes from the saved cursor", async () => {
    const c = clock();
    const { store, jobs } = fakeStore([job()], c.now);
    expect(await store.claim("run-a", ["series_lookup"], 300_000)).not.toBeNull();
    await store.saveSlice(jobs[0], "run-a", { processed: 4, total: 10, cursor: { page: 2 } }, 300_000);
    c.advance(200_000);
    expect(await store.claim("run-b", ["series_lookup"], 300_000)).toBeNull();
    c.advance(200_000); // run-a crashed: its renewed lease is now over
    const taken = await store.claim("run-b", ["series_lookup"], 300_000);
    expect(taken).toMatchObject({ lockedBy: "run-b", processed: 4, cursor: { page: 2 } });
  });

  it("does not claim a job before not_before, or a kind without a handler", async () => {
    const c = clock();
    const { store } = fakeStore([job({ notBefore: new Date(c.now() + 60_000).toISOString() }), job({ id: "p", kind: "photo_scan" })], c.now);
    expect(await store.claim("r", ["series_lookup"], 1000)).toBeNull();
    c.advance(61_000);
    expect((await store.claim("r", ["series_lookup"], 1000))?.id).toBe("j1");
  });
});

describe("runTick: the slice loop", () => {
  it("works a job in slices, saving progress after each, until done", async () => {
    const c = clock();
    const { store, jobs, log } = fakeStore([job()], c.now);
    let n = 0;
    const handler = vi.fn(async (): Promise<SliceResult> => {
      c.advance(40_000);
      n++;
      return n < 3 ? { state: "continue", total: 3, processed: n, cursor: { n } } : { state: "done", total: 3, processed: 3, summary: { changedBooks: 3 } };
    });
    const res = await runTick({ store, handlers: handlerOf(handler), runId: "r1", now: c.now, budgetMs: 240_000 });
    expect(handler).toHaveBeenCalledTimes(3);
    expect(res.jobs).toEqual([{ id: "j1", kind: "series_lookup", slices: 3, outcome: "done" }]);
    expect(jobs[0]).toMatchObject({ status: "done", processed: 3, summary: { changedBooks: 3 } });
    expect(log.filter((l) => l.startsWith("save"))).toEqual(["save j1 1/3", "save j1 2/3", "save j1 3/3"]);
  });

  it("passes each slice a deadline no later than the tick's and the slice length", async () => {
    const c = clock();
    const { store } = fakeStore([job()], c.now);
    const deadlines: number[] = [];
    const start = c.now();
    await runTick({
      store, runId: "r", now: c.now, budgetMs: 100_000, sliceMs: 45_000,
      handlers: handlerOf(async ({ deadline }) => {
        deadlines.push(deadline - c.now());
        c.advance(deadline - c.now());
        return { state: "continue", processed: 1 };
      }),
    });
    expect(deadlines.slice(0, 2)).toEqual([45_000, 45_000]);
    expect(deadlines[2] ?? 10_000).toBeLessThanOrEqual(10_000);
    expect(c.now() - start).toBeLessThanOrEqual(100_000);
  });

  it("stops at the time budget and gives the job back for the next tick, with its cursor kept", async () => {
    const c = clock();
    const { store, jobs } = fakeStore([job()], c.now);
    const res = await runTick({
      store, runId: "r", now: c.now, budgetMs: 100_000,
      handlers: handlerOf(async () => {
        c.advance(45_000);
        return { state: "continue", total: 9, processed: 2, cursor: { at: 2 } };
      }),
    });
    expect(res.jobs[0].outcome).toBe("paused");
    expect(jobs[0]).toMatchObject({ status: "running", lockedBy: null, lockedUntil: null, cursor: { at: 2 } });
    expect(await store.claim("next", ["series_lookup"], 1000)).not.toBeNull();
  });

  it("on a rate limit saves progress, releases the job and holds it until not_before", async () => {
    const c = clock();
    const { store, jobs } = fakeStore([job()], c.now);
    const handler = vi.fn(async (): Promise<SliceResult> => ({ state: "wait", notBefore: c.now() + 60_000, total: 10, processed: 4, cursor: { at: 4 } }));
    const res = await runTick({ store, handlers: handlerOf(handler), runId: "r", now: c.now, budgetMs: 240_000 });
    expect(handler).toHaveBeenCalledTimes(1); // not retried within the same tick
    expect(res.jobs[0].outcome).toBe("waiting");
    expect(jobs[0]).toMatchObject({ processed: 4, cursor: { at: 4 }, lockedBy: null });
    expect(Date.parse(jobs[0].notBefore!)).toBe(c.now() + 60_000);
    expect(await store.claim("r2", ["series_lookup"], 1000)).toBeNull();
    c.advance(60_001);
    expect(await store.claim("r2", ["series_lookup"], 1000)).not.toBeNull();
  });

  it("stops quietly when the job was cancelled during a slice", async () => {
    const c = clock();
    const { store, jobs } = fakeStore([job()], c.now);
    const res = await runTick({
      store, runId: "r", now: c.now, budgetMs: 240_000,
      handlers: handlerOf(async () => {
        Object.assign(jobs[0], { status: "cancelled", lockedBy: null, lockedUntil: null });
        return { state: "continue", processed: 1 };
      }),
    });
    expect(res.jobs[0].outcome).toBe("cancelled");
    expect(jobs[0].status).toBe("cancelled");
  });

  it("does not report a cancelled job as done", async () => {
    const c = clock();
    const { store, jobs } = fakeStore([job()], c.now);
    await runTick({
      store, runId: "r", now: c.now,
      handlers: handlerOf(async () => {
        Object.assign(jobs[0], { status: "cancelled", lockedBy: null });
        return { state: "done", processed: 1 };
      }),
    });
    expect(jobs[0].status).toBe("cancelled");
  });

  it("retries a slice that throws, and fails the job after three throws in a row", async () => {
    const c = clock();
    const { store, jobs } = fakeStore([job()], c.now);
    let calls = 0;
    const flaky = async (): Promise<SliceResult> => {
      if (++calls < 3) throw new Error("db hiccup");
      return { state: "done" };
    };
    await runTick({ store, handlers: handlerOf(flaky), runId: "r", now: c.now });
    expect(jobs[0].status).toBe("done");

    const { store: s2, jobs: j2 } = fakeStore([job()], c.now);
    const always = vi.fn(async (): Promise<SliceResult> => {
      throw new Error("boom");
    });
    const res = await runTick({ store: s2, handlers: handlerOf(always), runId: "r", now: c.now });
    expect(always).toHaveBeenCalledTimes(3);
    expect(res.jobs[0].outcome).toBe("failed");
    expect(j2[0]).toMatchObject({ status: "failed", error: "boom" });
  });

  it("takes the next job after the first finishes, oldest first", async () => {
    const c = clock();
    const { store, jobs } = fakeStore([job({ id: "b", createdAt: "2026-11-20T00:00:02Z" }), job({ id: "a", createdAt: "2026-11-20T00:00:01Z" })], c.now);
    const order: string[] = [];
    await runTick({ store, runId: "r", now: c.now, handlers: handlerOf(async ({ job: j }) => (order.push(j.id), { state: "done" as const })) });
    expect(order).toEqual(["a", "b"]);
    expect(jobs.every((j) => j.status === "done")).toBe(true);
  });

  it("passes recordChanges through to the store for the running job", async () => {
    const c = clock();
    const { store, changes } = fakeStore([job()], c.now);
    await runTick({ store, runId: "r", now: c.now, handlers: handlerOf(async ({ recordChanges }) => (await recordChanges([{ bookId: "b1", before: { series_name: null }, after: { series_name: "Dune" } }]), { state: "done" as const })) });
    expect(changes).toEqual([{ jobId: "j1", changes: [{ bookId: "b1", before: { series_name: null }, after: { series_name: "Dune" } }] }]);
  });

  it("claims nothing when no handler is registered", async () => {
    const c = clock();
    const { store, log } = fakeStore([job()], c.now);
    expect((await runTick({ store, handlers: {}, runId: "r", now: c.now })).jobs).toEqual([]);
    expect(log).toEqual([]);
  });
});
