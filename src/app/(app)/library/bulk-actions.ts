"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit, fail, firstIssue, type ActionResult } from "@/lib/books/access";
import { MAX_BULK_BOOKS, planCopyChanges, type BulkBook, type BulkCopy } from "@/lib/books/bulk";
import { CONDITIONS, FORMATS, STATUSES } from "@/lib/books/constants";
import { MAX_MERGE_BOOKS, MIN_MERGE_BOOKS, mergeErrorMessage, mergeResultMessage, parseMergeCounts, type MergeBook, type MergeCounts } from "@/lib/books/merge";
import { getLibraryContext } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";

const base = {
  libraryId: z.string().uuid(),
  bookIds: z.array(z.string().uuid()).min(1, "Select at least one book.").max(MAX_BULK_BOOKS, `Select ${MAX_BULK_BOOKS} books or fewer.`),
};
const statusSchema = z.object({ ...base, status: z.enum(STATUSES) });
const copySchema = z.object({ ...base, format: z.enum(FORMATS).optional(), condition: z.enum(CONDITIONS).optional() });

/** Membership, role, and "every book is in this library", all through the person's own client (RLS applies). */
async function guard(libraryId: string, bookIds: string[]) {
  const { user, libraries } = await getLibraryContext();
  const library = libraries.find((l) => l.id === libraryId);
  if (!library) return { ok: false as const, error: "That library is not yours." };
  const ids = [...new Set(bookIds)];
  const supabase = await createClient();
  const { data, error } = await supabase.from("books").select("id").eq("library_id", libraryId).in("id", ids);
  if (error) return { ok: false as const, error: "Could not check those books." };
  if ((data ?? []).length !== ids.length) return { ok: false as const, error: "Some of those books are not in this library." };
  return { ok: true as const, user, supabase, role: library.role, ids };
}

/** Sets "my status" on every selected book. Per person, so any member may do it. Rating and notes are left alone. */
export async function bulkSetStatus(input: z.input<typeof statusSchema>): Promise<ActionResult<{ updated: number }>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    const g = await guard(parsed.data.libraryId, parsed.data.bookIds);
    if (!g.ok) return fail(g.error);
    // Only these three columns are written, so on an existing row the rating, notes and dates stay as they are.
    const { error } = await g.supabase
      .from("user_books")
      .upsert(g.ids.map((book_id) => ({ user_id: g.user.id, book_id, status: parsed.data.status })), { onConflict: "user_id,book_id" });
    if (error) return fail("Could not update the status.");
    revalidatePath("/library");
    return { ok: true, updated: g.ids.length };
  } catch {
    return fail("Could not update the status.");
  }
}

/**
 * Sets format and/or condition on the books' copies. Editors only. A book with one copy has it changed; an owned book
 * with none gets one; wishlist and borrowed books with none, and books with several copies, are skipped and counted.
 */
export async function bulkSetCopyFields(
  input: z.input<typeof copySchema>,
): Promise<ActionResult<{ updated: number; created: number; skippedMultiCopy: number; skippedNoCopy: number }>> {
  const parsed = copySchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { format, condition } = parsed.data;
  if (!format && !condition) return fail("Choose a format or a condition to set.");
  try {
    const g = await guard(parsed.data.libraryId, parsed.data.bookIds);
    if (!g.ok) return fail(g.error);
    if (!canEdit(g.role)) return fail("Only owners and editors can change the library.");

    const [{ data: books, error: bookError }, { data: copies, error: copyError }] = await Promise.all([
      g.supabase.from("books").select("id, ownership, isbn13").in("id", g.ids),
      g.supabase.from("copies").select("id, book_id").in("book_id", g.ids),
    ]);
    if (bookError || copyError) return fail("Could not load the copies.");
    const plan = planCopyChanges((books ?? []) as BulkBook[], (copies ?? []) as BulkCopy[]);

    const set = { ...(format ? { format } : {}), ...(condition ? { condition } : {}) };
    if (plan.update.length) {
      const { error } = await g.supabase.from("copies").update(set).in("id", plan.update);
      if (error) return fail("Could not update the copies.");
    }
    if (plan.create.length) {
      const { error } = await g.supabase
        .from("copies")
        .insert(plan.create.map((b) => ({ book_id: b.id, edition_isbn: b.isbn13, ...set })));
      if (error) return fail("Could not add the copies.");
    }
    revalidatePath("/library");
    return { ok: true, updated: plan.update.length, created: plan.create.length, skippedMultiCopy: plan.skippedMultiCopy, skippedNoCopy: plan.skippedNoCopy };
  } catch {
    return fail("Could not update the copies.");
  }
}

const mergeSchema = z.object({
  libraryId: z.string().uuid(),
  keepId: z.string().uuid(),
  mergeIds: z.array(z.string().uuid()).min(1, `Select at least ${MIN_MERGE_BOOKS} books to merge.`).max(MAX_MERGE_BOOKS - 1, `Merge ${MAX_MERGE_BOOKS} books or fewer.`),
  coverFromId: z.string().uuid().nullable().optional(),
});

/** A merge touches every member's records, so it is checked here (role, library) as well as inside merge_books. */
async function mergeGuard(libraryId: string, bookIds: string[]) {
  const ids = [...new Set(bookIds)];
  if (ids.length !== bookIds.length) return { ok: false as const, error: "Each book can be selected only once." };
  const g = await guard(libraryId, ids);
  if (!g.ok) return g;
  if (!canEdit(g.role)) return { ok: false as const, error: "Only owners and editors can merge books." };
  return g;
}

/** What the merge sheet needs about each selected book (ISBN, copies and reading records), in the order given. */
export async function loadMergeBooks(input: { libraryId: string; bookIds: string[] }): Promise<ActionResult<{ books: MergeBook[] }>> {
  const parsed = z
    .object({ libraryId: z.string().uuid(), bookIds: z.array(z.string().uuid()).min(MIN_MERGE_BOOKS, `Select at least ${MIN_MERGE_BOOKS} books to merge.`).max(MAX_MERGE_BOOKS, `Merge ${MAX_MERGE_BOOKS} books or fewer.`) })
    .safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    const g = await mergeGuard(parsed.data.libraryId, parsed.data.bookIds);
    if (!g.ok) return fail(g.error);
    const [books, copies, userBooks, reads] = await Promise.all([
      g.supabase.from("books").select("id, title, authors, series_name, series_position, isbn13, published_date, cover_url").in("id", g.ids),
      g.supabase.from("copies").select("book_id").in("book_id", g.ids),
      g.supabase.from("user_books").select("book_id").in("book_id", g.ids),
      g.supabase.from("reads").select("book_id").in("book_id", g.ids),
    ]);
    if (books.error || copies.error || userBooks.error || reads.error) return fail("Could not load those books.");
    const count = (rows: { book_id: string }[] | null) => {
      const m = new Map<string, number>();
      for (const r of rows ?? []) m.set(r.book_id, (m.get(r.book_id) ?? 0) + 1);
      return m;
    };
    const nCopies = count(copies.data);
    const nUser = count(userBooks.data);
    const nReads = count(reads.data);
    const byId = new Map((books.data ?? []).map((b) => [b.id as string, b]));
    const out: MergeBook[] = [];
    for (const id of parsed.data.bookIds) {
      const b = byId.get(id);
      if (!b) return fail("Some of those books no longer exist.");
      out.push({
        id,
        title: b.title,
        authors: b.authors ?? [],
        seriesName: b.series_name ?? null,
        seriesPosition: b.series_position ?? null,
        isbn13: b.isbn13 ?? null,
        publishedDate: b.published_date ?? null,
        coverUrl: b.cover_url ?? null,
        copies: nCopies.get(id) ?? 0,
        readingRecords: (nUser.get(id) ?? 0) + (nReads.get(id) ?? 0),
      });
    }
    return { ok: true, books: out };
  } catch {
    return fail("Could not load those books.");
  }
}

/** Merges the selected books into the one to keep. Owners and editors only; the work happens in merge_books. */
export async function mergeBooks(input: z.input<typeof mergeSchema>): Promise<ActionResult<{ counts: MergeCounts; message: string }>> {
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { libraryId, keepId, mergeIds, coverFromId } = parsed.data;
  if (mergeIds.includes(keepId)) return fail("The book you keep cannot also be merged away.");
  const all = [keepId, ...mergeIds];
  if (coverFromId && !all.includes(coverFromId)) return fail("The cover must come from one of the selected books.");
  try {
    const g = await mergeGuard(libraryId, all);
    if (!g.ok) return fail(g.error);
    const { data: keeper } = await g.supabase.from("books").select("title").eq("id", keepId).maybeSingle();
    const { data, error } = await g.supabase.rpc("merge_books", { p_keep: keepId, p_merge: mergeIds, p_cover_from: coverFromId ?? null });
    if (error) return fail(mergeErrorMessage(error.message));
    const counts = parseMergeCounts(data);
    if (!counts) return fail("Could not merge those books.");
    revalidatePath("/library");
    revalidatePath("/shelves");
    revalidatePath(`/books/${keepId}`);
    return { ok: true, counts, message: mergeResultMessage((keeper as { title?: string } | null)?.title ?? "the book you kept", counts) };
  } catch {
    return fail("Could not merge those books.");
  }
}
