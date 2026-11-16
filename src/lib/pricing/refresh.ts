import type { TaskOutcome } from "@/lib/jobs/daily";
import { EbayError, type PriceRequest, type PriceResult } from "./ebay";

/**
 * The daily price refresh: physical copies with an ISBN whose price is more than 7 days old (or was never checked),
 * stalest first. All I/O is injected, so the budgeting is tested without eBay or a database.
 *
 * Limits, per run:
 *  - at most CALL_BUDGET eBay search calls (a price check costs one or two). eBay's default Browse API allowance is thousands
 *    of calls a day (5,000 on a standard keyset), so 300 leaves the on-demand checks (30 per person per day) plenty of room.
 *  - stops before the task's time deadline.
 *  - CONCURRENCY searches in flight at once, so a run finishes a useful batch inside its time share.
 * Progress is durable in the rows themselves (a checked copy is no longer stale); the cursor in cron_runs keeps the staleness
 * cutoff of an unfinished sweep, so a resumed run keeps working through the same set.
 */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const CALL_BUDGET = 300;
export const CONCURRENCY = 3;
export const BATCH_SIZE = 30;
/** Stop starting new work this close to the deadline. */
export const DEADLINE_MARGIN_MS = 3_000;
/** A price check uses at most this many search calls (condition-matched, then widened). */
const MAX_CALLS_PER_CHECK = 2;

export type Candidate = { copyId: string; format: string; condition: PriceRequest["condition"]; isbn: string; priceRegion: string };

export type RefreshDeps = {
  fetchCandidates(cutoffIso: string, limit: number): Promise<Candidate[]>;
  price(req: PriceRequest): Promise<PriceResult>;
  recordPriced(c: Candidate, res: Extract<PriceResult, { status: "priced" }>): Promise<void>;
  recordNoPrice(c: Candidate): Promise<void>;
  now(): number;
};

export async function runPriceRefresh(
  deps: RefreshDeps,
  opts: { deadline: number; cursor: unknown; callBudget?: number; concurrency?: number; batchSize?: number },
): Promise<TaskOutcome> {
  const budget = opts.callBudget ?? CALL_BUDGET;
  const concurrency = opts.concurrency ?? CONCURRENCY;
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const savedCutoff = (opts.cursor as { cutoff?: string } | null)?.cutoff;
  const cutoff = typeof savedCutoff === "string" ? savedCutoff : new Date(deps.now() - STALE_AFTER_MS).toISOString();

  const tally = { checked: 0, priced: 0, noPrice: 0, errors: 0, calls: 0 };
  const failed = new Set<string>();
  let stop: string | null = null;
  const partial = (reason: string): TaskOutcome => ({ status: "partial", cursor: { cutoff }, detail: { ...tally, reason } });

  while (!stop) {
    if (deps.now() > opts.deadline - DEADLINE_MARGIN_MS) return partial("out of time");
    if (budget - tally.calls < MAX_CALLS_PER_CHECK) return partial("call budget used");

    // Copies that failed this run stay stale in the database, so ask for enough rows to step past them.
    const rows = (await deps.fetchCandidates(cutoff, batchSize + failed.size)).filter((c) => !failed.has(c.copyId));
    if (rows.length === 0) return { status: "complete", detail: { ...tally } };

    for (let i = 0; i < rows.length && !stop; ) {
      if (deps.now() > opts.deadline - DEADLINE_MARGIN_MS) return partial("out of time");
      const room = Math.floor((budget - tally.calls) / MAX_CALLS_PER_CHECK);
      if (room < 1) return partial("call budget used");
      const chunk = rows.slice(i, i + Math.min(concurrency, room));
      i += chunk.length;

      const settled = await Promise.all(
        chunk.map(async (c) => {
          try {
            const res = await deps.price({ isbn: c.isbn, format: c.format, condition: c.condition, marketplace: c.priceRegion });
            return { c, res } as const;
          } catch (error) {
            return { c, error } as const;
          }
        }),
      );

      for (const s of settled) {
        if ("error" in s) {
          const e = s.error;
          if (e instanceof EbayError && e.kind === "no_result") {
            tally.checked++;
            tally.noPrice++;
            tally.calls += MAX_CALLS_PER_CHECK;
            await deps.recordNoPrice(s.c);
          } else if (e instanceof EbayError && e.kind === "rate_limited") {
            stop = "eBay rate limit reached";
            failed.add(s.c.copyId);
          } else if (e instanceof EbayError && (e.kind === "config" || e.kind === "auth")) {
            // Keys missing or wrong: nothing will work this run. Surface it as a failed run.
            throw e;
          } else {
            tally.errors++;
            failed.add(s.c.copyId);
          }
          continue;
        }
        tally.calls += s.res.calls;
        tally.checked++;
        if (s.res.status === "priced") {
          tally.priced++;
          await deps.recordPriced(s.c, s.res);
        } else {
          // Not priceable (a malformed ISBN): mark it checked so it stops heading the queue.
          tally.noPrice++;
          await deps.recordNoPrice(s.c);
        }
      }
    }
  }
  return partial(stop);
}
