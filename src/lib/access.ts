import "server-only";
import { cache } from "react";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { providersFor, type ProviderPolicy } from "@/lib/metadata/policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Access control for the paid and quota-limited features (Claude, eBay, Hardcover and Google Books).
 * Sign-up is open and manual cataloguing is free; "full access" is granted per account by an app admin
 * (public.user_entitlements, written only by the set_full_access RPC). Every server action and route that can reach
 * one of those services asks here first; the database repeats the check on the paid tables as defense in depth.
 */

/** One sentence, shown wherever a feature is locked. */
export const FULL_ACCESS_NEEDED = "Full access needed. Ask the app admin to turn on full access for your account.";

export type FullAccessDenied = { ok: false; error: string; code: "full_access_required" };

export const fullAccessDenied = (): FullAccessDenied => ({ ok: false, error: FULL_ACCESS_NEEDED, code: "full_access_required" });

/** The 403 a route handler returns when full access is missing. `extra` carries the route's own error shape. */
export function fullAccessResponse(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ...extra, ok: false, error: FULL_ACCESS_NEEDED, code: "full_access_required" }, { status: 403 });
}

// Per-request memo. React's cache gives each request its own holder (outside a request it does not memoize, which is
// still correct, only slower). Keyed by person, so two clients for one request share the answer.
const requestMemo = cache(() => ({
  access: new Map<string, Promise<boolean>>(),
  admin: new Map<string, Promise<boolean>>(),
  library: new Map<string, Promise<boolean>>(),
}));

async function rpcFlag(supabase: SupabaseClient, fn: "has_full_access" | "is_app_admin", userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc(fn, { uid: userId });
  // Fail closed: a database error is "no access", never "access".
  return !error && data === true;
}

/** True when the person has been granted full access. Cached for the request. */
export function hasFullAccess(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const memo = requestMemo().access;
  let hit = memo.get(userId);
  if (!hit) {
    hit = rpcFlag(supabase, "has_full_access", userId);
    memo.set(userId, hit);
  }
  return hit;
}

/** True when the person is an app admin. Cached for the request. */
export function isAppAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const memo = requestMemo().admin;
  let hit = memo.get(userId);
  if (!hit) {
    hit = rpcFlag(supabase, "is_app_admin", userId);
    memo.set(userId, hit);
  }
  return hit;
}

export type FullAccessGrant = { ok: true; user: User; supabase: SupabaseClient };

/**
 * The signed-in person when they have full access, otherwise the typed "full access needed" result.
 * Not signed in is also a denial (the proxy already redirects page loads; this covers direct calls).
 */
export async function requireFullAccess(): Promise<FullAccessGrant | FullAccessDenied> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fullAccessDenied();
  if (!(await hasFullAccess(supabase, data.user.id))) return fullAccessDenied();
  return { ok: true, user: data.user, supabase };
}

/** The provider policy for a person: Hardcover, Google and Open Library with full access, Open Library only without. */
export async function providerPolicyFor(supabase: SupabaseClient, userId: string): Promise<ProviderPolicy> {
  return providersFor(await hasFullAccess(supabase, userId));
}

// ------------------------------------------------------------------ libraries (cron and the Discover page)

/** User ids with full access among `userIds` (all of them when omitted), read with the service role. */
export async function grantedUserIds(admin: SupabaseClient, userIds?: string[]): Promise<Set<string>> {
  let query = admin.from("user_entitlements").select("user_id").eq("full_access", true).limit(5000);
  if (userIds) query = query.in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query;
  if (error) throw new Error(`user_entitlements: ${error.message}`);
  return new Set((data ?? []).map((r) => r.user_id as string));
}

/** Ids of libraries that have at least one member with full access. Used by the cron to skip everything else. */
export async function grantedLibraryIds(admin: SupabaseClient): Promise<Set<string>> {
  const granted = await grantedUserIds(admin);
  if (granted.size === 0) return new Set();
  const { data, error } = await admin.from("library_members").select("library_id").in("user_id", [...granted]).limit(10000);
  if (error) throw new Error(`library_members: ${error.message}`);
  return new Set((data ?? []).map((r) => r.library_id as string));
}

/**
 * True when at least one member of the library has full access. Read with the service role (a member cannot read other
 * members' entitlements), cached for the request, and false when the service role is not configured.
 */
export function libraryHasGrantedMember(libraryId: string, admin?: SupabaseClient): Promise<boolean> {
  const memo = requestMemo().library;
  let hit = memo.get(libraryId);
  if (!hit) {
    hit = (async () => {
      try {
        const client = admin ?? createAdminClient();
        const { data, error } = await client.from("library_members").select("user_id").eq("library_id", libraryId).limit(1000);
        if (error || !data?.length) return false;
        return (await grantedUserIds(client, data.map((m) => m.user_id as string))).size > 0;
      } catch {
        return false;
      }
    })();
    memo.set(libraryId, hit);
  }
  return hit;
}
