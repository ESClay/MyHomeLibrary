import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildHandlers } from "./handlers";
import { supabaseJobStore } from "./store";
import { runTick, type TickResult } from "./worker";

/** Claims and works due jobs for up to `budgetMs`. The one entry point the route, the daily cron, and the "kick" after queueing share. */
export async function runJobsTick(admin: SupabaseClient, budgetMs?: number): Promise<TickResult> {
  return runTick({ store: supabaseJobStore(admin), handlers: buildHandlers(admin), runId: randomUUID(), budgetMs });
}
