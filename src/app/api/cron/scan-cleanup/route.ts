import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { StorageCleanupError, cleanupScanBatch } from "@/lib/jobs/scan-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * GET /api/cron/scan-cleanup (Authorization: Bearer $CRON_SECRET): removes scan photos older than 24 hours
 * for jobs whose review was never finished (or whose delete failed), through the Storage API.
 * Jobs still "pending" or "processing" that long are abandoned and marked failed.
 * The daily dispatcher (/api/cron/daily) runs the same logic; this route stays for running it by hand.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await cleanupScanBatch(createAdminClient()));
  } catch (e) {
    const message = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: message }, { status: e instanceof StorageCleanupError ? 502 : 500 });
  }
}
