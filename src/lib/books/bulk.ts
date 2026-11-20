import type { Condition, Format, Ownership } from "@/lib/books/constants";

/** Pure decisions and wording for the library's bulk edit, kept apart from the server actions so they can be tested alone. */

export const MAX_BULK_BOOKS = 500;
/** Most books one metadata pull handles, so a run stays a few minutes at the Hardcover pace. */
export const MAX_REFRESH_BOOKS = 100;

export type CopyFields = { format?: Format; condition?: Condition };
export type BulkBook = { id: string; ownership: Ownership; isbn13: string | null };
export type BulkCopy = { id: string; book_id: string };

export type CopyPlan = {
  /** Copy ids to update (the book has exactly one copy). */
  update: string[];
  /** Books that get a new copy (owned, no copy yet). */
  create: BulkBook[];
  skippedMultiCopy: number;
  skippedNoCopy: number;
};

/**
 * Decides, book by book, what a bulk format/condition change does:
 * one copy: change it; none on an owned book: add one; none on a wishlist or borrowed book: skip (adding a copy would
 * turn a wishlist book into an owned one); two or more copies: skip, since which one is meant is unknown.
 */
export function planCopyChanges(books: BulkBook[], copies: BulkCopy[]): CopyPlan {
  const byBook = new Map<string, string[]>();
  for (const c of copies) byBook.set(c.book_id, [...(byBook.get(c.book_id) ?? []), c.id]);
  const plan: CopyPlan = { update: [], create: [], skippedMultiCopy: 0, skippedNoCopy: 0 };
  for (const book of books) {
    const ids = byBook.get(book.id) ?? [];
    if (ids.length === 1) plan.update.push(ids[0]);
    else if (ids.length > 1) plan.skippedMultiCopy += 1;
    else if (book.ownership === "owned") plan.create.push(book);
    else plan.skippedNoCopy += 1;
  }
  return plan;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Updated 9 books. Skipped 2 with more than one copy." */
export function copyResultMessage(r: { updated: number; created: number; skippedMultiCopy: number; skippedNoCopy: number }): string {
  const changed = r.updated + r.created;
  const parts = [changed === 0 ? "No books changed." : `Updated ${plural(changed, "book", "books")}.`];
  if (r.skippedMultiCopy) parts.push(`Skipped ${r.skippedMultiCopy} with more than one copy.`);
  if (r.skippedNoCopy) parts.push(`Skipped ${r.skippedNoCopy} on the wishlist or borrowed with no copy.`);
  return parts.join(" ");
}

/** "Marked 3 books as read." */
export const markedReadMessage = (n: number) => `Marked ${plural(n, "book", "books")} as read.`;

export type RefreshOutcome = "updated" | "upToDate" | "noMatch" | "failed" | "denied";

/** Sorts the answer of `refreshMetadata` into a category, from its structured `outcome` / `code` only. */
export function classifyRefresh(
  res: { ok: true; outcome: "updated" | "upToDate" } | { ok: false; code?: "no_match" | "full_access_required" },
): RefreshOutcome {
  if (res.ok) return res.outcome;
  if (res.code === "full_access_required") return "denied";
  if (res.code === "no_match") return "noMatch";
  return "failed";
}

export type RefreshTally = { updated: number; upToDate: number; noMatch: number; failed: number };
export const emptyTally = (): RefreshTally => ({ updated: 0, upToDate: 0, noMatch: 0, failed: 0 });

/** "Updated 14, already up to date 4, no match 2". */
export function refreshSummary(t: RefreshTally, opts: { stopped?: boolean; denied?: string | null } = {}): string {
  const parts: string[] = [];
  if (t.updated) parts.push(`Updated ${t.updated}`);
  if (t.upToDate) parts.push(`already up to date ${t.upToDate}`);
  if (t.noMatch) parts.push(`no match ${t.noMatch}`);
  if (t.failed) parts.push(`failed ${t.failed}`);
  let text = parts.length ? parts.join(", ") : "Nothing changed";
  text = text.charAt(0).toUpperCase() + text.slice(1) + ".";
  if (opts.denied) text += ` Stopped: ${opts.denied}`;
  else if (opts.stopped) text += " Stopped early.";
  return text;
}
