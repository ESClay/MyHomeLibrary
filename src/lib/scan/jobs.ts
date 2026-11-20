import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { capStatus, capWindowStart, DAY_MS, type CapStatus } from "./photo";

export const SCANS_BUCKET = "scans";

/**
 * Photo reads that count toward today's cap: every job in the last 24 hours except the ones that
 * failed before the model was ever called (those cost nothing, so they should not use up a read).
 */
export async function dailyScanStatus(supabase: SupabaseClient, userId: string, now = Date.now()): Promise<CapStatus> {
  const { count } = await supabase
    .from("scan_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", capWindowStart(now))
    .or("status.neq.failed,input_tokens.not.is.null");
  return capStatus(count ?? 0);
}

/**
 * Deletes a scan photo through the Storage API (never SQL) and stamps the job. Safe to call twice.
 * Returns false when the storage call failed, so the cleanup sweep still has the job to retry.
 */
export async function deleteScanPhoto(
  supabase: SupabaseClient,
  job: { id: string; photo_path: string },
  status?: "saved",
): Promise<boolean> {
  const { error } = await supabase.storage.from(SCANS_BUCKET).remove([job.photo_path]);
  if (error) return false;
  await supabase
    .from("scan_jobs")
    .update({ photo_deleted_at: new Date().toISOString(), ...(status ? { status } : {}) })
    .eq("id", job.id);
  return true;
}

/**
 * Photo reads the worker has actually started in the last 24 hours. Unlike dailyScanStatus it leaves out photos that
 * are still waiting their turn (status "pending"), so a queued batch does not count against itself.
 */
export async function dailyReadsStatus(supabase: SupabaseClient, userId: string, now = Date.now()): Promise<CapStatus> {
  const { count } = await supabase
    .from("scan_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "pending")
    .gte("created_at", capWindowStart(now))
    .or("status.neq.failed,input_tokens.not.is.null");
  return capStatus(count ?? 0);
}

/** When the oldest counted read ages out of the 24-hour window (ms), i.e. when one more photo may be read. */
export async function nextCapReset(supabase: SupabaseClient, userId: string, now = Date.now()): Promise<number> {
  const { data } = await supabase
    .from("scan_jobs")
    .select("created_at")
    .eq("user_id", userId)
    .neq("status", "pending")
    .gte("created_at", capWindowStart(now))
    .or("status.neq.failed,input_tokens.not.is.null")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const oldest = data?.created_at ? Date.parse(data.created_at as string) : now;
  return Math.max(now + 60_000, oldest + DAY_MS + 1_000);
}
