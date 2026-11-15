import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

/** Service-role client. Bypasses RLS: only for cron jobs, never for anything a user triggers. */
export function createAdminClient() {
  const env = getSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !key) throw new Error("Supabase service role is not configured (SUPABASE_SERVICE_ROLE_KEY).");
  return createSupabaseClient(env.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
