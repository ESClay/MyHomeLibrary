import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RecommendError, requestPicks, RECOMMEND_MODEL, type RecommendUsage } from "@/lib/ai/recommend";
import {
  PER_CATEGORY_TARGET,
  SHARED_TARGET,
  buildPersonalPrompt,
  buildSharedPrompt,
  libraryProfile,
  personalCategories,
  personalReady,
  personalSignal,
  sharedSignal,
  type FeedbackRow,
  type LibraryTitle,
  type Person,
  type UserBookRow,
} from "@/lib/ai/recommend-prompt";
import type { RecommendScope } from "@/lib/ai/recommend-schema";
import { FULL_ACCESS_NEEDED, hasFullAccess, libraryHasGrantedMember } from "@/lib/access";
import { ALL_PROVIDERS, search } from "@/lib/metadata";
import { capMessage, capWindowStart, nextRefreshAt, refreshCap } from "./caps";
import { buildLibraryIndex, inLibrary, type LibraryBookLite } from "./match";
import { buildPickSet, type CategoryTargets } from "./pick-set";
import type { StoredPick } from "./types";

/** Not enough books (or, for a shared set, ratings) yet; the message says how many more help. */
export class NotEnoughSignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotEnoughSignal";
  }
}

/** The person has used today's refreshes. */
export class CapReached extends Error {
  constructor(
    message: string,
    readonly nextAt: Date | null,
  ) {
    super(message);
    this.name = "CapReached";
  }
}

/** The person (or, for the cron job, the library) is not entitled to Claude recommendations. */
export class AccessDenied extends Error {
  constructor() {
    super(FULL_ACCESS_NEEDED);
    this.name = "AccessDenied";
  }
}

const PAGE = 1000;

type BookRow = {
  id: string;
  title: string;
  authors: string[] | null;
  isbn13: string | null;
  hardcover_id: number | null;
  series_id: string | null;
  series_name: string | null;
  genres: string[] | null;
  ownership: string | null;
  copies: { edition_isbn: string | null }[] | null;
};

export type LibraryBook = LibraryBookLite & { id: string; seriesId: string | null; seriesName: string | null; genres: string[]; ownership: string | null };

/** Every book in the library (any ownership) in the shape the matchers use. */
export async function loadLibraryBooks(client: SupabaseClient, libraryId: string): Promise<LibraryBook[]> {
  const out: LibraryBook[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("books")
      .select("id, title, authors, isbn13, hardcover_id, series_id, series_name, genres, ownership, copies(edition_isbn)")
      .eq("library_id", libraryId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const b of (data ?? []) as unknown as BookRow[]) {
      out.push({
        id: b.id,
        title: b.title,
        authors: b.authors ?? [],
        isbn13: b.isbn13,
        hardcoverId: b.hardcover_id,
        seriesId: b.series_id,
        seriesName: b.series_name,
        genres: b.genres ?? [],
        ownership: b.ownership,
        copyIsbns: (b.copies ?? []).map((c) => c.edition_isbn).filter((i): i is string => !!i),
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

type UserBookJoin = {
  user_id: string;
  status: UserBookRow["status"];
  rating: number | null;
  notes: string | null;
  updated_at: string | null;
  books: { title: string; authors: string[] | null; library_id: string } | { title: string; authors: string[] | null; library_id: string }[] | null;
};

/**
 * Reading data of the given people in one library. Each person's rows are selected by their own user id, so a
 * personal profile never reads anyone else's rows; notes are read here and dropped by the shared prompt builder.
 */
export async function loadUserRows(client: SupabaseClient, libraryId: string, userIds: string[]): Promise<UserBookRow[]> {
  const rows: UserBookRow[] = [];
  for (const userId of userIds) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from("user_books")
        .select("user_id, status, rating, notes, updated_at, books!inner(title, authors, library_id)")
        .eq("user_id", userId)
        .eq("books.library_id", libraryId)
        .order("book_id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as unknown as UserBookJoin[]) {
        const b = Array.isArray(r.books) ? r.books[0] : r.books;
        if (!b) continue;
        rows.push({
          userId: r.user_id,
          title: b.title,
          authors: b.authors ?? [],
          status: r.status,
          rating: r.rating === null ? null : Number(r.rating),
          notes: r.notes,
          updatedAt: r.updated_at,
        });
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return rows;
}

export async function loadFeedback(client: SupabaseClient, userIds: string[]): Promise<(FeedbackRow & { workKey: string })[]> {
  const { data, error } = await client
    .from("recommendation_feedback")
    .select("work_key, feedback, title, authors")
    .in("user_id", userIds)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => ({ workKey: f.work_key as string, feedback: f.feedback, title: f.title, authors: f.authors ?? [] }));
}

/** Members of a library with their display names (made unique so the model can tell them apart). */
export async function loadMembers(client: SupabaseClient, libraryId: string): Promise<Person[]> {
  const { data, error } = await client.from("library_members").select("user_id, profiles(display_name, email)").eq("library_id", libraryId).order("created_at");
  if (error) throw new Error(error.message);
  const seen = new Map<string, number>();
  return (data ?? []).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    const base = (p?.display_name || p?.email?.split("@")[0] || "Reader").trim() || "Reader";
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return { id: m.user_id as string, name: n > 1 ? `${base} (${n})` : base };
  });
}

/** Manual generations (including failed ones that cost tokens) in the last 24 hours. */
export async function refreshUsage(client: SupabaseClient, scope: RecommendScope, key: { libraryId: string; userId: string }, now = Date.now()) {
  let q = client
    .from("recommendation_sets")
    .select("generated_at")
    .eq("scope", scope)
    .eq("trigger_source", "manual")
    .eq("library_id", key.libraryId)
    .gte("generated_at", capWindowStart(now))
    .order("generated_at");
  if (scope === "personal") q = q.eq("user_id", key.userId);
  const { data } = await q;
  const used = data?.length ?? 0;
  const status = refreshCap(scope, used);
  return { ...status, nextAt: status.reached ? nextRefreshAt(data?.[0]?.generated_at ?? null) : null };
}

export type SetRow = {
  id: string;
  generatedAt: string;
  items: StoredPick[];
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  status: "ok" | "failed";
  error: string | null;
};

/** The newest successful set and the one before it. */
export async function latestSets(client: SupabaseClient, scope: RecommendScope, key: { libraryId: string; userId: string }): Promise<{ latest: SetRow | null; previous: SetRow | null }> {
  let q = client
    .from("recommendation_sets")
    .select("id, generated_at, items, model, input_tokens, output_tokens, status, error")
    .eq("scope", scope)
    .eq("library_id", key.libraryId)
    .eq("status", "ok")
    .order("generated_at", { ascending: false })
    .limit(2);
  if (scope === "personal") q = q.eq("user_id", key.userId);
  const { data } = await q;
  const toRow = (r: NonNullable<typeof data>[number]): SetRow => ({
    id: r.id,
    generatedAt: r.generated_at,
    items: (r.items ?? []) as StoredPick[],
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    status: r.status,
    error: r.error,
  });
  return { latest: data?.[0] ? toRow(data[0]) : null, previous: data?.[1] ? toRow(data[1]) : null };
}

export type GenerateParams = {
  /** A client that may read the needed rows and insert the set: the signed-in user's, or the service role. */
  client: SupabaseClient;
  scope: RecommendScope;
  libraryId: string;
  /** The person asking (personal) or pressing Refresh (shared); null for the cron job on a shared set. */
  userId: string | null;
  trigger: "manual" | "cron";
  /** Feedback of these people is used to drop picks (the requester; for the cron job, every member). */
  blockFor?: string[];
};

export type GenerateOutcome = { count: number; usage: RecommendUsage; calls: number; model: string | null };

/** How long to keep sets that are still inside the cap window, whatever their rank (so the cap count stays correct). */
async function pruneSets(client: SupabaseClient, scope: RecommendScope, p: { libraryId: string; userId: string | null }, now: number) {
  let q = client
    .from("recommendation_sets")
    .select("id, generated_at")
    .eq("scope", scope)
    .eq("library_id", p.libraryId)
    .order("generated_at", { ascending: false });
  q = scope === "personal" && p.userId ? q.eq("user_id", p.userId) : q;
  const { data } = await q.range(0, 60);
  if (!data) return;
  const cutoff = capWindowStart(now);
  // Keep the latest two successful sets (the page shows one, the other is the previous) and everything inside the window.
  const stale = data.slice(2).filter((r) => r.generated_at < cutoff).map((r) => r.id as string);
  if (stale.length) await client.from("recommendation_sets").delete().in("id", stale);
}

/**
 * Builds and stores one recommendation set. Enforces the daily cap for manual refreshes, checks there is enough
 * rated data, makes at most two model calls, records the model and token usage, and prunes old sets.
 * Throws CapReached, NotEnoughSignal or RecommendError (a failed call that spent tokens is recorded first).
 */
export async function generateSet(p: GenerateParams, now = Date.now()): Promise<GenerateOutcome> {
  const { client, scope, libraryId } = p;
  // The one place Claude is reached for recommendations, so the entitlement is checked here as well as by the callers:
  // a manual refresh needs the requesting person to have full access (a shared set too); the cron job needs the person
  // (personal) or at least one member of the library (shared) to have it.
  const allowed =
    p.trigger === "manual" || scope === "personal"
      ? p.userId !== null && (await hasFullAccess(client, p.userId))
      : await libraryHasGrantedMember(libraryId, client);
  if (!allowed) throw new AccessDenied();

  if (p.trigger === "manual" && p.userId) {
    const cap = await refreshUsage(client, scope, { libraryId, userId: p.userId }, now);
    if (cap.reached) {
      throw new CapReached(capMessage(scope, cap.nextAt, now), cap.nextAt);
    }
  }

  const members = scope === "shared" ? await loadMembers(client, libraryId) : [];
  const userIds = scope === "personal" ? [p.userId as string] : members.map((m) => m.id);
  const [books, rows] = await Promise.all([loadLibraryBooks(client, libraryId), loadUserRows(client, libraryId, userIds)]);

  const library: LibraryTitle[] = books.map((b) => ({ title: b.title, authors: b.authors, genres: b.genres, series: b.seriesName, ownership: b.ownership ?? undefined }));
  const libraryIndex = buildLibraryIndex(books);

  let makePrompt: Parameters<typeof buildPickSet>[0]["deps"]["prompt"];
  let target: number;
  let categoryTargets: CategoryTargets | undefined;
  let ownFeedback: (FeedbackRow & { workKey: string })[] = [];

  if (scope === "personal") {
    // The library is enough to start from; ratings only unlock the "ratings" group.
    const ready = personalReady(library.length);
    if (!ready.enough) {
      throw new NotEnoughSignal(`Add at least ${ready.needed} books to your library to get picks. It has ${ready.books}.`);
    }
    const categories = personalCategories(libraryProfile(library), personalSignal(rows, p.userId as string).enough);
    categoryTargets = Object.fromEntries(categories.map((c) => [c, PER_CATEGORY_TARGET]));
    ownFeedback = await loadFeedback(client, [p.userId as string]);
    const person = (await loadMembers(client, libraryId)).find((m) => m.id === p.userId) ?? { id: p.userId as string, name: "this reader" };
    makePrompt = (topUp) => buildPersonalPrompt({ person, rows, library, feedback: ownFeedback, topUp });
    target = PER_CATEGORY_TARGET * categories.length;
  } else {
    const signal = sharedSignal(rows, userIds);
    if (!signal.enough) {
      throw new NotEnoughSignal(
        userIds.length < 2
          ? "Invite someone to this library to get picks for both of you."
          : `Each of you needs at least ${signal.needed} rated books to get picks for both of you.`,
      );
    }
    makePrompt = (topUp) => buildSharedPrompt({ members, rows, library, topUp });
    target = SHARED_TARGET;
    // Feedback is private to each person; the filter only drops picks any available person already declined.
    ownFeedback = await loadFeedback(client, p.blockFor ?? (p.userId ? [p.userId] : []));
  }

  const blocked = new Set(ownFeedback.filter((f) => f.feedback === "not_interested" || f.feedback === "already_read").map((f) => f.workKey));
  const base = {
    scope,
    library_id: libraryId,
    user_id: scope === "personal" ? p.userId : null,
    requested_by: scope === "shared" ? p.userId : null,
    trigger_source: p.trigger,
    model: RECOMMEND_MODEL,
  };

  try {
    const set = await buildPickSet({
      scope,
      target,
      categoryTargets,
      deps: { prompt: makePrompt, request: (prompt, s) => requestPicks(prompt, s), search: (q) => search(q, ALL_PROVIDERS), inLibrary: (c) => inLibrary(libraryIndex, c), blocked },
    });
    const prompt = makePrompt();
    const { error } = await client.from("recommendation_sets").insert({
      ...base,
      model: set.model ?? RECOMMEND_MODEL,
      items: set.items,
      prompt_context: { ...prompt.stats, calls: set.calls, dropped: set.dropped, topUpError: set.topUpError },
      input_tokens: set.usage.inputTokens,
      output_tokens: set.usage.outputTokens,
      status: "ok",
    });
    if (error) throw new Error(error.message);
    await pruneSets(client, scope, { libraryId, userId: p.userId }, now);
    return { count: set.items.length, usage: set.usage, calls: set.calls, model: set.model };
  } catch (e) {
    // A call that spent tokens but produced nothing is recorded so it still counts toward the cap and the cost.
    if (e instanceof RecommendError && e.usage) {
      await client.from("recommendation_sets").insert({
        ...base,
        items: [],
        input_tokens: e.usage.inputTokens,
        output_tokens: e.usage.outputTokens,
        status: "failed",
        error: e.kind,
      });
    }
    throw e;
  }
}
