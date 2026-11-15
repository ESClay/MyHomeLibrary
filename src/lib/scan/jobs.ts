import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { capStatus, capWindowStart, type CapStatus } from "./photo";

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
