import type { Job } from "./types";

type Row = Record<string, unknown>;

/** A `jobs` table row as a Job. */
export function rowToJob(r: Row): Job {
  return {
    id: r.id as string,
    libraryId: r.library_id as string,
    userId: (r.user_id as string | null) ?? null,
    kind: r.kind as Job["kind"],
    status: r.status as Job["status"],
    total: Number(r.total ?? 0),
    processed: Number(r.processed ?? 0),
    cursor: r.cursor ?? null,
    summary: (r.summary as Record<string, unknown> | null) ?? {},
    error: (r.error as string | null) ?? null,
    notBefore: (r.not_before as string | null) ?? null,
    lockedUntil: (r.locked_until as string | null) ?? null,
    lockedBy: (r.locked_by as string | null) ?? null,
    createdAt: r.created_at as string,
    startedAt: (r.started_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
    seenAt: (r.seen_at as string | null) ?? null,
  };
}

