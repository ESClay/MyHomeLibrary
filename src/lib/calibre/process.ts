import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookMetadata } from "@/lib/metadata/types";
import type { Lookups } from "@/lib/scan/resolve";
import { findMetadata, gapFill, type GapFields } from "./enrich";
import type { JobRow, RowResult } from "./plan";

/** Everything one batch shares: who is importing, where, and how lookups are paced. */
export type BatchContext = {
  supabase: SupabaseClient;
  userId: string;
  libraryId: string;
  enrich: boolean;
  lookups: Lookups;
  take: () => Promise<boolean>;
  /** True when a provider just answered "too many requests". */
  limited: () => boolean;
  /** Set once a rate limit is seen: the rest of the batch is saved without lookups. */
  state: { rateLimited: boolean };
  /** Ids of the books this batch saved (or added a copy to), for the shelves chosen at review. */
  touched: string[];
};

type Db = SupabaseClient;

async function recordRead(db: Db, userId: string, bookId: string, row: JobRow, isNew: boolean): Promise<string | undefined> {
  try {
    if (row.status) {
      let write = true;
      if (!isNew) {
        // An existing book may already have this person's own status. Do not overwrite it.
        const { data } = await db.from("user_books").select("status").eq("user_id", userId).eq("book_id", bookId).maybeSingle();
        write = !data || !data.status;
      }
      if (write) {
        const { error } = await db
          .from("user_books")
          .upsert({ user_id: userId, book_id: bookId, status: row.status }, { onConflict: "user_id,book_id" });
        if (error) return `Saved, but the reading status was not recorded: ${error.message}`;
      }
    }
    if (row.status === "read" && row.finishedAt) {
      if (!isNew) {
        const { data } = await db
          .from("reads")
          .select("id")
          .eq("user_id", userId)
          .eq("book_id", bookId)
          .eq("finished_at", row.finishedAt)
          .limit(1);
        if (data && data.length > 0) return undefined;
      }
      const { error } = await db
        .from("reads")
        .insert({ user_id: userId, book_id: bookId, started_at: null, finished_at: row.finishedAt });
      if (error) return `Saved, but the finish date was not recorded: ${error.message}`;
    }
  } catch (e) {
    return `Saved, but the reading status was not recorded: ${e instanceof Error ? e.message : "unknown error"}`;
  }
  return undefined;
}

async function addBook(ctx: BatchContext, row: JobRow): Promise<RowResult> {
  const db = ctx.supabase;
  const base: RowResult = { n: row.n, title: row.title, outcome: "added", enriched: false };

  let gaps: GapFields = {};
  if (ctx.enrich && !ctx.state.rateLimited) {
    let meta: BookMetadata | null = null;
    try {
      const found = await findMetadata(
        { title: row.title, authors: row.authors, series: row.series, seriesPosition: row.seriesPosition, isbn13: row.isbn13 },
        ctx.lookups,
        ctx.take,
        ctx.limited,
      );
      if (found.kind === "found") meta = found.meta;
      else if (found.kind === "rate-limited") ctx.state.rateLimited = true;
    } catch {
      meta = null; // A lookup problem never fails the row.
    }
    gaps = gapFill(
      { title: row.title, authors: row.authors, series: row.series, seriesPosition: row.seriesPosition, isbn13: row.isbn13 },
      meta,
    );
    base.enriched = meta !== null;
  }

  const { data: created, error } = await db
    .from("books")
    .insert({
      library_id: ctx.libraryId,
      title: row.title,
      authors: row.authors,
      // Calibre's values first; a provider only fills what is empty.
      series_name: row.series ?? gaps.series_name ?? null,
      series_position: row.seriesPosition ?? gaps.series_position ?? null,
      description: row.description,
      published_date: row.publishedDate,
      isbn13: row.isbn13,
      calibre_uuid: row.calibreUuid,
      cover_url: gaps.cover_url ?? null,
      page_count: gaps.page_count ?? null,
      genres: gaps.genres ?? [],
      public_rating: gaps.public_rating ?? null,
      public_rating_count: gaps.public_rating_count ?? null,
      rating_source: gaps.rating_source ?? null,
      hardcover_id: gaps.hardcover_id ?? null,
      google_books_id: gaps.google_books_id ?? null,
      ol_key: gaps.ol_key ?? null,
      ownership: "owned",
    })
    .select("id")
    .single();

  if (error || !created) {
    if (error?.code === "23505" && row.calibreUuid) {
      return { ...base, outcome: "skipped", enriched: false, message: "Already imported from this Calibre library." };
    }
    return { ...base, outcome: "failed", enriched: false, message: error?.message ?? "The book could not be saved." };
  }

  const { error: copyError } = await db
    .from("copies")
    .insert({ book_id: created.id, format: "ebook", condition: null, edition_isbn: row.isbn13 });
  if (copyError) {
    await db.from("books").delete().eq("id", created.id);
    return { ...base, outcome: "failed", enriched: false, message: copyError.message };
  }

  ctx.touched.push(created.id);
  const warning = await recordRead(db, ctx.userId, created.id, row, true);
  return warning ? { ...base, warning } : base;
}

async function addEbookCopy(ctx: BatchContext, row: JobRow): Promise<RowResult> {
  const db = ctx.supabase;
  const base: RowResult = { n: row.n, title: row.title, outcome: "copied", enriched: false };
  if (!row.targetBookId) return { ...base, outcome: "failed", message: "The matching book could not be found." };

  const { data: book } = await db.from("books").select("id, ownership").eq("id", row.targetBookId).maybeSingle();
  if (!book) return { ...base, outcome: "failed", message: "The matching book is no longer in the library." };

  // A retried batch must not stack a second identical e-book copy.
  let existing = db.from("copies").select("id").eq("book_id", row.targetBookId).eq("format", "ebook");
  existing = row.isbn13 ? existing.eq("edition_isbn", row.isbn13) : existing.is("edition_isbn", null);
  const { data: have } = await existing.limit(1);
  if (have && have.length > 0) return { ...base, outcome: "skipped", message: "That book already has this e-book copy." };

  const { error } = await db
    .from("copies")
    .insert({ book_id: row.targetBookId, format: "ebook", condition: null, edition_isbn: row.isbn13 });
  if (error) return { ...base, outcome: "failed", message: error.message };
  // Owning a copy means the book is no longer just on the wishlist.
  if (book.ownership === "wishlist") await db.from("books").update({ ownership: "owned" }).eq("id", row.targetBookId);

  ctx.touched.push(row.targetBookId);
  const warning = await recordRead(db, ctx.userId, row.targetBookId, row, false);
  return warning ? { ...base, warning } : base;
}

export async function processRow(ctx: BatchContext, row: JobRow): Promise<RowResult> {
  try {
    return row.action === "copy" ? await addEbookCopy(ctx, row) : await addBook(ctx, row);
  } catch (e) {
    return { n: row.n, title: row.title, outcome: "failed", enriched: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}
