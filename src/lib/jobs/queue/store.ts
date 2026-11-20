import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookChange, JobKind, JobStore } from "./types";
import { mergeChange } from "./changes";

import { rowToJob } from "./store-row";

type Row = Record<string, unknown>;

const iso = (ms: number) => new Date(ms).toISOString();

/** The queue on Supabase, through the service-role client. Every write is scoped to the run that holds the lease. */
export function supabaseJobStore(admin: SupabaseClient): JobStore {
  return {
    async claim(runId, kinds: JobKind[], leaseMs) {
      const { data, error } = await admin.rpc("claim_job", { p_run: runId, p_kinds: kinds, p_lease_seconds: Math.round(leaseMs / 1000) });
      if (error) throw new Error(`claim_job: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as Row | null | undefined;
      return row?.id ? rowToJob(row) : null;
    },

    async saveSlice(job, runId, patch, leaseMs) {
      const update: Row = { locked_until: iso(Date.now() + leaseMs) };
      if (patch.total !== undefined) update.total = patch.total;
      if (patch.processed !== undefined) update.processed = patch.processed;
      if (patch.cursor !== undefined) update.cursor = patch.cursor;
      if (patch.summary !== undefined) update.summary = patch.summary;
      // Matching on status and lock holder means a cancelled job, or one whose lease another run took, updates nothing.
      const { data, error } = await admin.from("jobs").update(update).eq("id", job.id).eq("status", "running").eq("locked_by", runId).select("id");
      if (error) throw new Error(`jobs: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },

    async release(job, runId, notBefore) {
      const { error } = await admin
        .from("jobs")
        .update({ locked_until: null, locked_by: null, not_before: notBefore ? iso(notBefore) : null })
        .eq("id", job.id)
        .eq("locked_by", runId)
        .in("status", ["queued", "running"]);
      if (error) throw new Error(`jobs: ${error.message}`);
    },

    async finish(job, runId, outcome) {
      const { error } = await admin
        .from("jobs")
        .update({
          status: outcome.status,
          error: outcome.error ?? null,
          ...(outcome.summary ? { summary: outcome.summary } : {}),
          finished_at: iso(Date.now()),
          locked_until: null,
          locked_by: null,
          not_before: null,
          // Nothing to review and nothing went wrong: no badge.
          ...(outcome.status === "done" && Number((outcome.summary as { changedBooks?: number } | undefined)?.changedBooks ?? 1) === 0 ? { seen_at: iso(Date.now()) } : {}),
        })
        .eq("id", job.id)
        .eq("locked_by", runId)
        .eq("status", "running");
      if (error) throw new Error(`jobs: ${error.message}`);
    },

    async recordChanges(jobId, changes: BookChange[]) {
      if (changes.length === 0) return;
      const ids = [...new Set(changes.map((c) => c.bookId))];
      const existing = new Map<string, BookChange>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await admin.from("job_changes").select("book_id, before, after").eq("job_id", jobId).in("book_id", ids.slice(i, i + 200));
        if (error) throw new Error(`job_changes: ${error.message}`);
        for (const r of data ?? []) existing.set(r.book_id as string, { bookId: r.book_id as string, before: r.before as BookChange["before"], after: r.after as BookChange["after"] });
      }
      const merged = new Map<string, BookChange>(existing);
      for (const c of changes) merged.set(c.bookId, mergeChange(merged.get(c.bookId), c));
      const rows = [...merged.values()].map((c) => ({ job_id: jobId, book_id: c.bookId, before: c.before, after: c.after }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await admin.from("job_changes").upsert(rows.slice(i, i + 200), { onConflict: "job_id,book_id" });
        if (error) throw new Error(`job_changes: ${error.message}`);
      }
    },
  };
}
