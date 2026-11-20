import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { runJobsTick } from "@/lib/jobs/queue/tick";
import { createAdminClient } from "@/lib/supabase/admin";

/** Hobby with fluid compute allows up to 300 s; the worker stops itself at about 240 s (TICK_BUDGET_MS). */
export const maxDuration = 300;

async function tick(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured; no job can run." }, { status: 503 });
  }
  try {
    return NextResponse.json(await runJobsTick(admin));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

/**
 * POST /api/jobs/tick (Authorization: Bearer $CRON_SECRET), called every minute by Supabase pg_cron through pg_net.
 * Claims due jobs and works them in slices (see lib/jobs/queue/worker.ts). GET does the same, for a manual curl.
 */
export const POST = tick;
export const GET = tick;
