import type { Job, JobHandlers, JobKind, JobStore } from "./types";

/** How long a lease lasts. Renewed after every slice, so a live worker never loses it and a dead one frees it in minutes. */
export const LEASE_MS = 5 * 60 * 1000;
/** The longest one slice of work may run; progress and the lease are saved at least this often. */
export const SLICE_MS = 45_000;
/** A tick works for about this long (the route allows 300 s). */
export const TICK_BUDGET_MS = 240_000;
/** Not worth starting another slice with less than this left. */
const MIN_SLICE_MS = 8_000;
/** A job whose slices throw this many times in a row is marked failed. */
export const MAX_SLICE_ERRORS = 3;

export type TickResult = {
  runId: string;
  jobs: { id: string; kind: JobKind; slices: number; outcome: "done" | "failed" | "cancelled" | "waiting" | "paused" | "lost" }[];
};

/**
 * One tick: claim due jobs one after another and work each in slices until the time runs out. Pure of I/O besides the
 * injected store and handlers, so it is tested with a fake clock. A crash leaves the lease to expire; the next tick
 * resumes from the saved cursor.
 */
export async function runTick(input: {
  store: JobStore;
  handlers: JobHandlers;
  runId: string;
  now?: () => number;
  budgetMs?: number;
  sliceMs?: number;
  leaseMs?: number;
}): Promise<TickResult> {
  const now = input.now ?? Date.now;
  const budgetMs = input.budgetMs ?? TICK_BUDGET_MS;
  const sliceMs = input.sliceMs ?? SLICE_MS;
  const leaseMs = input.leaseMs ?? LEASE_MS;
  const deadline = now() + budgetMs;
  const kinds = Object.keys(input.handlers) as JobKind[];
  const out: TickResult = { runId: input.runId, jobs: [] };
  if (kinds.length === 0) return out;

  // Jobs this tick has given back or paused are not claimed again in the same tick.
  while (deadline - now() >= MIN_SLICE_MS) {
    const job = await input.store.claim(input.runId, kinds, leaseMs);
    if (!job) break;
    const entry = { id: job.id, kind: job.kind, slices: 0, outcome: "paused" as TickResult["jobs"][number]["outcome"] };
    out.jobs.push(entry);
    const handler = input.handlers[job.kind];
    if (!handler) {
      await input.store.release(job, input.runId, now() + 10 * 60_000);
      entry.outcome = "waiting";
      continue;
    }

    let current: Job = job;
    let errors = 0;
    for (;;) {
      if (deadline - now() < MIN_SLICE_MS) {
        await input.store.release(current, input.runId); // out of time: due again at the next tick
        entry.outcome = "paused";
        break;
      }
      const sliceDeadline = Math.min(deadline, now() + sliceMs);
      let result;
      try {
        result = await handler({ job: current, deadline: sliceDeadline, tickDeadline: deadline, now, recordChanges: (c) => input.store.recordChanges(current.id, c) });
        errors = 0;
      } catch (e) {
        errors++;
        const message = e instanceof Error ? e.message : "failed";
        if (errors >= MAX_SLICE_ERRORS) {
          await input.store.finish(current, input.runId, { status: "failed", error: message });
          entry.outcome = "failed";
          break;
        }
        continue; // a transient failure: try the slice again (the loop re-checks the time left)
      }
      entry.slices++;

      if (result.state === "failed") {
        await input.store.finish(current, input.runId, { status: "failed", error: result.error, summary: result.summary });
        entry.outcome = "failed";
        break;
      }
      if (result.state === "done") {
        // saveSlice first so a cancelled job is not reported as done.
        const kept = await input.store.saveSlice(current, input.runId, { total: result.total, processed: result.processed, summary: result.summary }, leaseMs);
        if (!kept) {
          entry.outcome = "cancelled";
          break;
        }
        await input.store.finish(current, input.runId, { status: "done", summary: result.summary });
        entry.outcome = "done";
        break;
      }
      const kept = await input.store.saveSlice(current, input.runId, { total: result.total, processed: result.processed, cursor: result.cursor, summary: result.summary }, leaseMs);
      if (!kept) {
        entry.outcome = "cancelled";
        break;
      }
      current = {
        ...current,
        total: result.total ?? current.total,
        processed: result.processed ?? current.processed,
        cursor: result.cursor ?? current.cursor,
        summary: result.summary ?? current.summary,
      };
      if (result.state === "wait") {
        await input.store.release(current, input.runId, result.notBefore);
        entry.outcome = "waiting";
        break;
      }
    }
  }
  return out;
}
