import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SCANS_BUCKET } from "@/lib/scan/jobs";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CLEANUP_BATCH = 200;

export type CleanupBatch = { removed: number; abandoned: number; more: boolean };

/**
 * Removes one batch of scan photos older than 24 hours for jobs whose review was never finished (or whose delete
 * failed), through the Storage API (never SQL). Jobs still "pending" or "processing" that long are marked failed.
 * Throws on a database or storage failure. Safe to run again at any time.
 */
export async function cleanupScanBatch(admin: SupabaseClient, now = Date.now()): Promise<CleanupBatch> {
  const cutoff = new Date(now - MAX_AGE_MS).toISOString();
  const { data: jobs, error } = await admin
    .from("scan_jobs")
    .select("id, photo_path, status")
    .is("photo_deleted_at", null)
    .lt("created_at", cutoff)
    .order("created_at")
    .limit(CLEANUP_BATCH);
  if (error) throw new Error(error.message);
  if (!jobs || jobs.length === 0) return { removed: 0, abandoned: 0, more: false };

  const { error: removeError } = await admin.storage.from(SCANS_BUCKET).remove(jobs.map((j) => j.photo_path));
  if (removeError) throw new StorageCleanupError(removeError.message);

  const stamp = new Date(now).toISOString();
  const ids = jobs.map((j) => j.id);
  await admin.from("scan_jobs").update({ photo_deleted_at: stamp }).in("id", ids);
  const abandoned = jobs.filter((j) => j.status === "pending" || j.status === "processing").map((j) => j.id);
  if (abandoned.length) await admin.from("scan_jobs").update({ status: "failed", error: "Abandoned" }).in("id", abandoned);
  return { removed: jobs.length, abandoned: abandoned.length, more: jobs.length === CLEANUP_BATCH };
}

/** The storage call failed (the route reports it as a 502). */
export class StorageCleanupError extends Error {}
