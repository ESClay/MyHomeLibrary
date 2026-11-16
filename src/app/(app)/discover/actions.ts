"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RecommendError, recommendConfigured } from "@/lib/ai/recommend";
import { canEdit, fail, firstIssue, roleInLibrary, type ActionResult } from "@/lib/books/access";
import { fullAccessDenied, hasFullAccess } from "@/lib/access";
import { requireUser } from "@/lib/library";
import { AccessDenied, CapReached, NotEnoughSignal, generateSet, latestSets } from "@/lib/discover/recs";
import { syncLibrarySeries } from "@/lib/discover/series-sync";
import { entryToMetadata, createInputFromMetadata } from "@/lib/discover/to-book";
import type { StoredPick } from "@/lib/discover/types";
import { hardcoverConfigured } from "@/lib/metadata/hardcover";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createBook, addRead, saveMyBook } from "@/app/(app)/books/actions";

const uuid = z.string().uuid();
const NOT_EDITOR = "Only owners and editors can add books to the library.";

async function member(libraryId: string) {
  const parsed = uuid.safeParse(libraryId);
  if (!parsed.success) return { ok: false as const, error: "That library is not valid." };
  const user = await requireUser();
  const role = await roleInLibrary(parsed.data, user.id);
  if (!role) return { ok: false as const, error: "You are not a member of that library." };
  return { ok: true as const, user, role };
}

// ------------------------------------------------------------------ series

const SERIES_REFRESH_MIN_AGE_MS = 5 * 60 * 1000;

/** Re-syncs one series (when `seriesId` is given) or looks for the library's series. The caller must be a member. */
export async function refreshSeries(input: { libraryId: string; seriesId?: string }): Promise<ActionResult<{ message: string }>> {
  const parsed = z.object({ libraryId: uuid, seriesId: uuid.optional() }).safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const who = await member(parsed.data.libraryId);
  if (!who.ok) return fail(who.error);
  // Series sync calls Hardcover: full access only. (The cron syncs libraries that have a granted member.)
  if (!(await hasFullAccess(await createClient(), who.user.id))) return fullAccessDenied();

  if (!hardcoverConfigured()) return fail("Series lookup is not set up on this server yet (no Hardcover token).");
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return fail("Series sync is not configured on this server yet (SUPABASE_SERVICE_ROLE_KEY).");
  }

  if (parsed.data.seriesId) {
    // Membership is already checked; this also confirms the series belongs to this library and is not hammered.
    const supabase = await createClient();
    const { count } = await supabase
      .from("books")
      .select("id", { count: "exact", head: true })
      .eq("library_id", parsed.data.libraryId)
      .eq("series_id", parsed.data.seriesId);
    if (!count) return fail("That series is not part of this library.");
    const { data: s } = await supabase.from("series").select("synced_at").eq("id", parsed.data.seriesId).maybeSingle();
    if (s?.synced_at && Date.now() - new Date(s.synced_at).getTime() < SERIES_REFRESH_MIN_AGE_MS) {
      return { ok: true, message: "Already refreshed a moment ago." };
    }
  }

  const res = await syncLibrarySeries(admin, parsed.data.libraryId, {
    budgetMs: 45_000,
    onlySeriesId: parsed.data.seriesId,
  });
  revalidatePath("/discover");
  if (res.unconfigured) return fail("Series lookup is not set up on this server yet.");
  if (res.rateLimited) return fail("Hardcover is limiting requests right now. Try again in a minute.");
  if (res.errors.length && res.syncedSeries === 0 && res.linkedBooks === 0) return fail("Could not reach Hardcover. Try again shortly.");
  const parts = [
    res.linkedBooks ? `${res.linkedBooks} book${res.linkedBooks === 1 ? "" : "s"} filed under a series` : null,
    res.syncedSeries ? `${res.syncedSeries} series updated` : null,
    res.remaining ? `${res.remaining} more to check, run it again to continue` : null,
  ].filter(Boolean);
  return { ok: true, message: parts.length ? `${parts.join(", ")}.` : "Everything is up to date." };
}

/** Adds a missing series volume to the wishlist. The entry is read from the cache, never taken from the browser. */
export async function wishlistEntry(input: { libraryId: string; entryId: string }): Promise<ActionResult<{ id?: string; message?: string }>> {
  const parsed = z.object({ libraryId: uuid, entryId: uuid }).safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const who = await member(parsed.data.libraryId);
  if (!who.ok) return fail(who.error);
  if (!canEdit(who.role)) return fail(NOT_EDITOR);

  const supabase = await createClient();
  const { data: e } = await supabase
    .from("series_entries")
    .select("id, series_id, position, title, authors, hardcover_book_id, isbn13, cover_url, release_date, is_compilation, series(name)")
    .eq("id", parsed.data.entryId)
    .maybeSingle();
  if (!e) return fail("That book is no longer listed.");
  const { count } = await supabase
    .from("books")
    .select("id", { count: "exact", head: true })
    .eq("library_id", parsed.data.libraryId)
    .eq("series_id", e.series_id);
  if (!count) return fail("That series is not part of this library.");

  const series = Array.isArray(e.series) ? e.series[0] : e.series;
  const meta = entryToMetadata(
    {
      id: e.id,
      position: e.position === null ? null : Number(e.position),
      title: e.title,
      authors: e.authors ?? [],
      hardcoverBookId: e.hardcover_book_id === null ? null : Number(e.hardcover_book_id),
      isbn13: e.isbn13,
      coverUrl: e.cover_url,
      releaseDate: e.release_date,
      isCompilation: e.is_compilation,
    },
    series?.name ?? "",
  );
  const res = await createBook(createInputFromMetadata(parsed.data.libraryId, meta, { ownership: "wishlist" }));
  revalidatePath("/discover");
  if (res.ok) return { ok: true, id: res.id };
  if (res.duplicates?.length) return { ok: true, id: res.duplicates[0].id, message: "Already in your library." };
  return fail(res.error);
}

// ------------------------------------------------------------------ recommendations

export async function refreshRecommendations(input: { libraryId: string; scope: "personal" | "shared" }): Promise<ActionResult<{ count: number }>> {
  const parsed = z.object({ libraryId: uuid, scope: z.enum(["personal", "shared"]) }).safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const who = await member(parsed.data.libraryId);
  if (!who.ok) return fail(who.error);
  // Both scopes call Claude; a shared set needs the requesting member to have full access too.
  if (!(await hasFullAccess(await createClient(), who.user.id))) return fullAccessDenied();
  if (!recommendConfigured()) return fail("Recommendations are not set up on this server yet.");

  try {
    const out = await generateSet({
      client: await createClient(),
      scope: parsed.data.scope,
      libraryId: parsed.data.libraryId,
      userId: who.user.id,
      trigger: "manual",
      blockFor: [who.user.id],
    });
    revalidatePath("/discover");
    if (out.count === 0) return fail("Nothing new to suggest right now. Try again after rating a few more books.");
    return { ok: true, count: out.count };
  } catch (e) {
    revalidatePath("/discover");
    if (e instanceof CapReached || e instanceof NotEnoughSignal || e instanceof RecommendError || e instanceof AccessDenied) return fail(e.message);
    console.error("[discover] refresh failed:", e instanceof Error ? e.message : e);
    return fail("Something went wrong choosing books. Try again.");
  }
}

/** The pick with this key in the person's latest personal or shared set. Never trusts what the browser sends. */
async function findPick(libraryId: string, userId: string, key: string): Promise<StoredPick | null> {
  const client = await createClient();
  for (const scope of ["personal", "shared"] as const) {
    const { latest, previous } = await latestSets(client, scope, { libraryId, userId });
    const hit = [latest, previous].flatMap((s) => s?.items ?? []).find((i) => i.key === key);
    if (hit) return hit;
  }
  return null;
}

async function saveFeedback(userId: string, pick: StoredPick, feedback: "not_interested" | "wishlisted" | "already_read") {
  const supabase = await createClient();
  const { error } = await supabase
    .from("recommendation_feedback")
    .upsert({ user_id: userId, work_key: pick.key, feedback, title: pick.title, authors: pick.authors }, { onConflict: "user_id,work_key" });
  return error?.message ?? null;
}

const pickInput = z.object({ libraryId: uuid, key: z.string().min(1).max(400) });

/** Feedback is always the signed-in person's own, including on a shared pick. */
export async function markNotInterested(input: z.input<typeof pickInput>): Promise<ActionResult> {
  const parsed = pickInput.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const who = await member(parsed.data.libraryId);
  if (!who.ok) return fail(who.error);
  const pick = await findPick(parsed.data.libraryId, who.user.id, parsed.data.key);
  if (!pick) return fail("That pick is no longer in your list.");
  const error = await saveFeedback(who.user.id, pick, "not_interested");
  if (error) return fail(error);
  revalidatePath("/discover");
  return { ok: true };
}

export async function wishlistPick(input: z.input<typeof pickInput>): Promise<ActionResult<{ id?: string; message?: string }>> {
  const parsed = pickInput.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const who = await member(parsed.data.libraryId);
  if (!who.ok) return fail(who.error);
  if (!canEdit(who.role)) return fail(NOT_EDITOR);
  const pick = await findPick(parsed.data.libraryId, who.user.id, parsed.data.key);
  if (!pick) return fail("That pick is no longer in your list.");

  const res = await createBook(createInputFromMetadata(parsed.data.libraryId, pick.book, { ownership: "wishlist" }));
  let id: string | undefined;
  let message: string | undefined;
  if (res.ok) id = res.id;
  else if (res.duplicates?.length) {
    id = res.duplicates[0].id;
    message = "Already in your library.";
  } else return fail(res.error);

  const error = await saveFeedback(who.user.id, pick, "wishlisted");
  if (error) return fail(error);
  revalidatePath("/discover");
  return { ok: true, id, message };
}

const readInput = pickInput.extend({
  /** Where the book goes: the library as owned, the wishlist, or nowhere. */
  placement: z.enum(["owned", "wishlist", "skip"]),
  rating: z.number().min(0.5).max(5).refine((n) => n * 2 === Math.floor(n * 2), "Ratings go in half-star steps.").nullable(),
  finishedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

/** Marks a pick "already read" and, if asked, logs the read and rating on a book created in (or already in) the library. */
export async function logAlreadyRead(input: z.input<typeof readInput>): Promise<ActionResult<{ id?: string }>> {
  const parsed = readInput.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { libraryId, key, placement, rating, finishedAt } = parsed.data;
  const who = await member(libraryId);
  if (!who.ok) return fail(who.error);
  const pick = await findPick(libraryId, who.user.id, key);
  if (!pick) return fail("That pick is no longer in your list.");

  const feedbackError = await saveFeedback(who.user.id, pick, "already_read");
  if (feedbackError) return fail(feedbackError);
  if (placement === "skip") {
    revalidatePath("/discover");
    return { ok: true };
  }
  if (!canEdit(who.role)) return fail(NOT_EDITOR);

  const created = await createBook(createInputFromMetadata(libraryId, pick.book, { ownership: placement, myStatus: "read" }));
  let bookId: string;
  if (created.ok) bookId = created.id;
  else if (created.duplicates?.length) bookId = created.duplicates[0].id;
  else return fail(created.error);

  const status = await saveMyBook({ bookId, status: "read", ...(rating !== null ? { rating } : {}) });
  if (!status.ok) return fail(status.error);
  if (finishedAt) {
    const read = await addRead({ bookId, read: { startedAt: null, finishedAt } });
    if (!read.ok) return fail(read.error);
  }
  revalidatePath("/discover");
  return { ok: true, id: bookId };
}
