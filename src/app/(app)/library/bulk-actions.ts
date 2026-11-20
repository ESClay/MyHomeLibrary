"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit, fail, firstIssue, type ActionResult } from "@/lib/books/access";
import { MAX_BULK_BOOKS, planCopyChanges, type BulkBook, type BulkCopy } from "@/lib/books/bulk";
import { CONDITIONS, FORMATS, STATUSES } from "@/lib/books/constants";
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
