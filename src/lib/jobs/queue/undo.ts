import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planUndo } from "./changes";
import { CHANGE_FIELDS, type BookChange } from "./types";

export type UndoOutcome = { undone: number; edited: number; failed: number };

/**
 * Undoes the recorded changes of one job (one book, or all of them) in one library. For each book only the fields that
 * still hold what the job wrote are put back (the write itself filters on those values, so an edit made a moment ago
 * is never overwritten). A book with nothing left to restore stays listed as "edited since". Needs the service role:
 * job_changes is written by it, and the caller has already checked that the person may edit this library.
 */
export async function undoJobChanges(admin: SupabaseClient, input: { jobId: string; libraryId: string; bookId?: string }): Promise<UndoOutcome> {
  const out: UndoOutcome = { undone: 0, edited: 0, failed: 0 };
  let q = admin.from("job_changes").select("id, book_id, before, after").eq("job_id", input.jobId).is("undone_at", null);
  if (input.bookId) q = q.eq("book_id", input.bookId);
  const { data: changes, error } = await q;
  if (error) throw new Error(error.message);
  if (!changes || changes.length === 0) return out;

  const bookIds = changes.map((c) => c.book_id as string);
  const current = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < bookIds.length; i += 200) {
    const { data, error: bookError } = await admin
      .from("books")
      .select("id, series_id, series_name, series_position, hardcover_id")
      .eq("library_id", input.libraryId)
      .in("id", bookIds.slice(i, i + 200));
    if (bookError) throw new Error(bookError.message);
    for (const b of data ?? []) current.set(b.id as string, b);
  }

  for (const c of changes) {
    const book = current.get(c.book_id as string);
    if (!book) continue; // not in this library (or deleted): nothing to restore
    const change = { before: c.before as BookChange["before"], after: c.after as BookChange["after"] };
    const { restore, edited } = planUndo(change, book);
    const fields = Object.keys(restore);
    if (fields.length === 0) {
      if (edited.length > 0) out.edited++;
      continue;
    }
    let update = admin.from("books").update(restore).eq("id", c.book_id as string).eq("library_id", input.libraryId);
    // Guard each field on the value the job wrote, so a concurrent edit wins.
    for (const f of CHANGE_FIELDS) {
      if (!(f in restore)) continue;
      const wrote = change.after[f] ?? null;
      update = wrote === null ? update.is(f, null) : update.eq(f, wrote);
    }
    const { data: hit, error: writeError } = await update.select("id");
    if (writeError) {
      out.failed++;
      continue;
    }
    if (!hit || hit.length === 0) {
      out.edited++;
      continue;
    }
    await admin.from("job_changes").update({ undone_at: new Date().toISOString() }).eq("id", c.id as string);
    out.undone++;
    if (edited.length > 0) out.edited++;
  }
  return out;
}
