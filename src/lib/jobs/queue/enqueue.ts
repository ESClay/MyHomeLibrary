import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToJob } from "./store-row";
import type { Job, JobKind } from "./types";

/**
 * Queues a job, or returns the one already active when the kind allows only one per library (series lookups: the
 * partial unique index answers with 23505). Needs the service-role client: people cannot insert jobs.
 */
export async function enqueueJob(admin: SupabaseClient, input: { libraryId: string; userId: string | null; kind: JobKind; total?: number; notBefore?: number }): Promise<{ job: Job; created: boolean }> {
  const { data, error } = await admin.from("jobs").insert({
      library_id: input.libraryId,
      user_id: input.userId,
      kind: input.kind,
      ...(input.total !== undefined ? { total: input.total } : {}),
      ...(input.notBefore !== undefined ? { not_before: new Date(input.notBefore).toISOString() } : {}),
    }).select("*").single();
  if (!error && data) return { job: rowToJob(data), created: true };
  if (error?.code === "23505") {
    const { data: active } = await admin
      .from("jobs")
      .select("*")
      .eq("library_id", input.libraryId)
      .eq("kind", input.kind)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active) return { job: rowToJob(active), created: false };
  }
  throw new Error(error?.message ?? "Could not queue the job.");
}
