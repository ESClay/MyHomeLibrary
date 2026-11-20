import { FULL_ACCESS_NEEDED } from "@/lib/access";
import type { CapStatus } from "@/lib/scan/photo";
import type { ScanOutcome } from "@/lib/scan/process";
import type { JobHandler } from "./types";

/** A photo read can take a minute or two, so one is only started when this much of the tick is left. */
export const MIN_PHOTO_MS = 90_000;
/** A photo left "processing" longer than this belongs to a run that died; it is read again. */
export const STALE_PROCESSING_MS = 6 * 60_000;
/** How long a rate-limited photo job waits before the next try. */
export const BUSY_WAIT_MS = 60_000;
/** Rate-limit waits in a row before the photo is left failed. */
export const MAX_BUSY_WAITS = 5;

export type PhotoRow = { id: string; status: string; updatedAt: number };

export type PhotoScanDeps = {
  hasFullAccess(userId: string): Promise<boolean>;
  /** Photo reads started in the last 24 hours (not counting photos still waiting). */
  readsStatus(userId: string, now: number): Promise<CapStatus>;
  /** When one more read is allowed again (ms). */
  nextCapReset(userId: string, now: number): Promise<number>;
  /** Every photo of the batch. */
  loadPhotos(jobId: string): Promise<PhotoRow[]>;
  /** Reads one photo (the shared identify-and-resolve function). */
  process(scanId: string): Promise<ScanOutcome>;
  /** Puts a photo back to pending. */
  requeue(scanId: string): Promise<void>;
  /** Marks the batch's unread photos failed with this message. */
  failUnread(jobId: string, message: string): Promise<void>;
};

export type PhotoCursor = { busyWaits?: number };

const tally = (rows: PhotoRow[]) => ({
  total: rows.length,
  unread: rows.filter((r) => r.status === "pending" || r.status === "processing").length,
  ready: rows.filter((r) => r.status === "ready" || r.status === "saved").length,
  failed: rows.filter((r) => r.status === "failed").length,
});

/**
 * The photo_scan handler: one slice reads one photo. Before it starts it checks the person still has full access, that
 * the tick has time for a read, and that today's photo-read cap has room. Over the cap, the job waits (not_before) until
 * the oldest read leaves the 24-hour window and says so in its summary so the page can show it.
 */
export function photoScanHandler(deps: PhotoScanDeps): JobHandler {
  return async ({ job, deadline, tickDeadline, now }) => {
    const cursor = (job.cursor ?? {}) as PhotoCursor;
    if (!job.userId) return { state: "failed", error: "This batch has no owner." };

    let rows = await deps.loadPhotos(job.id);
    const summaryOf = (extra: Record<string, unknown> = {}) => {
      const t = tally(rows);
      return { ready: t.ready, failed: t.failed, capWait: false, ...extra };
    };

    // Full access can be taken away while photos wait: nothing is sent to the model then.
    if (!(await deps.hasFullAccess(job.userId))) {
      await deps.failUnread(job.id, FULL_ACCESS_NEEDED);
      rows = await deps.loadPhotos(job.id);
      return { state: "failed", error: FULL_ACCESS_NEEDED, summary: summaryOf() };
    }

    // A photo whose run died is read again.
    for (const r of rows) {
      if (r.status === "processing" && now() - r.updatedAt > STALE_PROCESSING_MS) {
        await deps.requeue(r.id);
        r.status = "pending";
      }
    }

    const next = rows.find((r) => r.status === "pending");
    const t = tally(rows);
    if (!next) {
      if (t.unread > 0) return { state: "wait", notBefore: now() + 15_000, total: t.total, processed: t.total - t.unread, summary: summaryOf() }; // another run is mid-photo
      return { state: "done", total: t.total, processed: t.total, summary: summaryOf() };
    }

    // Not enough of the tick left for a whole read: hand the job back so the next tick takes it.
    if ((tickDeadline ?? deadline) - now() < MIN_PHOTO_MS) {
      return { state: "wait", notBefore: now() + 1_000, total: t.total, processed: t.total - t.unread, summary: summaryOf() };
    }

    const cap = await deps.readsStatus(job.userId, now());
    if (cap.reached) {
      const at = await deps.nextCapReset(job.userId, now());
      return { state: "wait", notBefore: at, total: t.total, processed: t.total - t.unread, summary: summaryOf({ capWait: true }) };
    }

    const outcome = await deps.process(next.id);
    let busyWaits = cursor.busyWaits ?? 0;
    if (!outcome.ok && outcome.kind === "busy" && outcome.status === 429 && busyWaits < MAX_BUSY_WAITS) {
      // The model is rate-limited: the photo goes back in the queue and the job waits a minute.
      await deps.requeue(next.id);
      busyWaits++;
      rows = await deps.loadPhotos(job.id);
      const t2 = tally(rows);
      return { state: "wait", notBefore: now() + BUSY_WAIT_MS, total: t2.total, processed: t2.total - t2.unread, cursor: { busyWaits }, summary: summaryOf() };
    }
    if (outcome.ok) busyWaits = 0;

    rows = await deps.loadPhotos(job.id);
    const after = tally(rows);
    const summary = summaryOf();
    if (after.unread === 0) return { state: "done", total: after.total, processed: after.total, summary };
    return { state: "continue", total: after.total, processed: after.total - after.unread, cursor: { busyWaits }, summary };
  };
}
