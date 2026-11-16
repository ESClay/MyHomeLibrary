/**
 * The client loop that feeds an import job to the server in batches. Server calls are injected so the loop is tested without a network.
 * It is resumable (it starts from the job's `processed`), retries a failed call, backs off after a rate limit and can be cancelled.
 */
import { BATCH_SIZE, RATE_LIMIT_PAUSE_MS } from "./limits";
import { etaSeconds } from "./plan";
import type { ImportSummary, JobRow, RowResult } from "./plan";

export type BatchResponse =
  | {
      ok: true;
      processed: number;
      total: number;
      status: "running" | "done" | "cancelled";
      results: RowResult[];
      summary: ImportSummary;
      rateLimited: boolean;
      unenriched: number;
    }
  | { ok: false; error: string; cancelled?: boolean };

export type RunnerDeps = {
  /** Rows [from, from + count) of the job. For a fresh import these are already in memory. */
  getRows: (from: number, count: number) => Promise<JobRow[]>;
  processBatch: (from: number, rows: JobRow[]) => Promise<BatchResponse>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type RunnerProgress = {
  processed: number;
  total: number;
  summary: ImportSummary;
  etaSeconds: number | null;
  /** A pause the person should hear about ("The catalogues are busy, waiting 30 seconds"). */
  waiting: string | null;
};

export type RunnerResult =
  | { state: "done"; summary: ImportSummary; processed: number }
  | { state: "cancelled"; summary: ImportSummary; processed: number }
  /** The loop gave up after retries. The job is intact and can be resumed. */
  | { state: "paused"; summary: ImportSummary; processed: number; error: string };

export const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2000, 5000];

export async function runImport(
  start: { processed: number; total: number; summary: ImportSummary; fallbackSecondsPerRow: number },
  deps: RunnerDeps,
  onProgress: (p: RunnerProgress) => void,
  shouldCancel: () => boolean,
): Promise<RunnerResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  let { processed, summary } = start;
  const { total } = start;
  let doneRows = 0;
  let activeMs = 0;

  const report = (waiting: string | null = null) =>
    onProgress({
      processed,
      total,
      summary,
      etaSeconds: etaSeconds(total - processed, doneRows, activeMs, start.fallbackSecondsPerRow),
      waiting,
    });
  report();

  while (processed < total) {
    if (shouldCancel()) return { state: "cancelled", summary, processed };
    const count = Math.min(BATCH_SIZE, total - processed);
    let rows: JobRow[];
    try {
      rows = await deps.getRows(processed, count);
    } catch (e) {
      return { state: "paused", summary, processed, error: e instanceof Error ? e.message : "The saved rows could not be loaded." };
    }
    if (rows.length === 0) return { state: "paused", summary, processed, error: "The saved rows could not be loaded." };

    let res: BatchResponse | null = null;
    let lastError = "The connection dropped.";
    const t0 = now();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        report(`Trying again in ${Math.round(RETRY_DELAYS_MS[attempt - 1] / 1000)} seconds`);
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }
      try {
        res = await deps.processBatch(processed, rows);
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : lastError;
      }
    }
    if (!res) return { state: "paused", summary, processed, error: lastError };
    if (!res.ok) {
      if (res.cancelled) return { state: "cancelled", summary, processed };
      return { state: "paused", summary, processed, error: res.error };
    }

    const advanced = res.processed - processed;
    // A reply that moved us somewhere else (a retried batch that had already landed) is accepted as the truth.
    processed = res.processed;
    summary = res.summary;
    if (res.status === "cancelled") return { state: "cancelled", summary, processed };
    if (advanced > 0 && res.results.length > 0) {
      doneRows += advanced;
      activeMs += now() - t0;
    }
    report();
    if (res.status === "done" || processed >= total) break;
    if (res.rateLimited) {
      report(`The catalogues are busy. Waiting ${Math.round(RATE_LIMIT_PAUSE_MS / 1000)} seconds before the next books.`);
      await sleep(RATE_LIMIT_PAUSE_MS);
      report();
    }
  }
  return { state: "done", summary, processed };
}
