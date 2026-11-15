import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { SCANS_BUCKET } from "@/lib/scan/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

/**
 * GET /api/cron/scan-cleanup (Authorization: Bearer $CRON_SECRET): removes scan photos older than 24 hours
 * for jobs whose review was never finished (or whose delete failed), through the Storage API.
 * Jobs still "pending" or "processing" that long are abandoned and marked failed.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();

  const { data: jobs, error } = await admin
    .from("scan_jobs")
    .select("id, photo_path, status")
    .is("photo_deleted_at", null)
    .lt("created_at", cutoff)
    .order("created_at")
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!jobs || jobs.length === 0) return NextResponse.json({ removed: 0, more: false });

  const { error: removeError } = await admin.storage.from(SCANS_BUCKET).remove(jobs.map((j) => j.photo_path));
  if (removeError) return NextResponse.json({ error: removeError.message }, { status: 502 });

  const now = new Date().toISOString();
  const ids = jobs.map((j) => j.id);
  await admin.from("scan_jobs").update({ photo_deleted_at: now }).in("id", ids);
  const abandoned = jobs.filter((j) => j.status === "pending" || j.status === "processing").map((j) => j.id);
  if (abandoned.length) await admin.from("scan_jobs").update({ status: "failed", error: "Abandoned" }).in("id", abandoned);

  return NextResponse.json({ removed: jobs.length, abandoned: abandoned.length, more: jobs.length === BATCH });
}
