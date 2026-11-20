import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { runJobsTick } from "@/lib/jobs/queue/tick";
import { runDaily } from "@/lib/jobs/daily";
import { priceRefreshTask, recommendationsTask, scanCleanupTask, seriesSyncTask, supabaseRunStore } from "@/lib/jobs/tasks";
import { createAdminClient } from "@/lib/supabase/admin";

/** Hobby with fluid compute allows up to 300 s; the dispatcher stops itself well before that (see BUDGET_MS). */
export const maxDuration = 300;

/** Leaves a margin under maxDuration for the last task to finish and the run to be recorded. */
const BUDGET_MS = 200_000;
/** After the daily tasks, queued jobs get what is left (the fallback if pg_cron is off), up to this long. */
const TICK_MAX_MS = 85_000;

/**
 * GET /api/cron/daily (Authorization: Bearer $CRON_SECRET), called once a day by Vercel Cron. Runs whichever tasks are
 * due (scan photo cleanup and price refresh daily, series re-sync and recommendation refresh weekly), each within its share of the time
 * budget, and records the last run of each in `cron_runs`. A task whose environment is not configured is skipped
 * without affecting the others; a task that fails or runs out of time is retried on the next run.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured; no cron task can run." }, { status: 503 });
  }
  try {
    const startedAt = Date.now();
    const result = await runDaily({
      store: supabaseRunStore(admin),
      runners: {
        "scan-cleanup": scanCleanupTask(admin),
        "series-sync": seriesSyncTask(admin),
        "price-refresh": priceRefreshTask(admin),
        recommendations: recommendationsTask(admin),
      },
      env: process.env,
      budgetMs: BUDGET_MS,
    });
    // The series task only queues work; this tick is the fallback that moves queued jobs along once a day.
    let jobs: unknown = null;
    try {
      const left = Math.min(TICK_MAX_MS, 285_000 - (Date.now() - startedAt));
      if (left > 10_000) jobs = await runJobsTick(admin, left);
    } catch (e) {
      jobs = { error: e instanceof Error ? e.message : "failed" };
    }
    return NextResponse.json({ ...result, jobs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
