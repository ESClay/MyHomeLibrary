/** The shared job queue: types the worker, the store and the handlers agree on. No I/O here. */

export type JobKind = "series_lookup" | "photo_scan";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type Job = {
  id: string;
  libraryId: string;
  userId: string | null;
  kind: JobKind;
  status: JobStatus;
  total: number;
  processed: number;
  cursor: unknown;
  summary: Record<string, unknown>;
  error: string | null;
  notBefore: string | null;
  lockedUntil: string | null;
  lockedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  seenAt: string | null;
};

/** The fields a series lookup can change on a book, and so can record and undo. */
export const CHANGE_FIELDS = ["series_id", "series_name", "series_position", "hardcover_id"] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];
export type FieldValues = Partial<Record<ChangeField, string | number | null>>;
export type BookChange = { bookId: string; before: FieldValues; after: FieldValues };

/** What a handler reports after one slice of work. */
export type SliceResult =
  | { state: "continue"; total?: number; processed?: number; cursor?: unknown; summary?: Record<string, unknown> }
  | { state: "done"; total?: number; processed?: number; summary?: Record<string, unknown> }
  /** Stop for now (a rate limit): the job is released and not picked up again before `notBefore`. */
  | { state: "wait"; notBefore: number; total?: number; processed?: number; cursor?: unknown; summary?: Record<string, unknown> }
  | { state: "failed"; error: string; summary?: Record<string, unknown> };

export type SliceContext = {
  job: Job;
  /** Absolute time (ms) the slice must finish by. */
  deadline: number;
  /** When the whole tick ends (ms). A slice is capped at 45 s, but a handler whose unit of work is longer (a photo read) uses this to decide whether to start it. Omitted in older callers: use `deadline`. */
  tickDeadline?: number;
  now: () => number;
  /** Writes undo-log rows (merged per book within the job). */
  recordChanges: (changes: BookChange[]) => Promise<void>;
};

/** One handler per job kind. It does a slice of work, resuming from `job.cursor`, and must return before `deadline`. */
export type JobHandler = (ctx: SliceContext) => Promise<SliceResult>;
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

/** The queue's storage. The real one is Supabase (store.ts); tests use an in-memory one. */
export type JobStore = {
  /** Atomically leases one due job of these kinds, or returns null. */
  claim(runId: string, kinds: JobKind[], leaseMs: number): Promise<Job | null>;
  /** Saves progress and extends the lease. Returns false when the job is no longer this run's to work on (cancelled, or the lease was lost). */
  saveSlice(job: Job, runId: string, patch: { total?: number; processed?: number; cursor?: unknown; summary?: Record<string, unknown> }, leaseMs: number): Promise<boolean>;
  /** Gives the job back to the queue, held until `notBefore` (ms), or immediately when omitted. */
  release(job: Job, runId: string, notBefore?: number): Promise<void>;
  finish(job: Job, runId: string, outcome: { status: "done" | "failed"; error?: string; summary?: Record<string, unknown> }): Promise<void>;
  recordChanges(jobId: string, changes: BookChange[]): Promise<void>;
};
