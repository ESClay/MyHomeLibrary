"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";
import { findDuplicates, type DuplicateMatch } from "@/lib/duplicates";
import { refreshFor } from "@/lib/metadata";
import { authorizeBook, canEdit, fail, firstIssue, roleInLibrary, type ActionResult } from "@/lib/books/access";
import { loadDuplicateCandidates } from "@/lib/books/data";
import {
  addReadSchema,
  copyActionSchema,
  createBookSchema,
  duplicateCheckSchema,
  myBookSchema,
  updateBookSchema,
  updateCopySchema,
  updateReadSchema,
  type CopyInput,
  type CreateBookInput,
} from "@/lib/books/schemas";
import { z } from "zod";

export type DuplicateInfo = {
  id: string;
  title: string;
  authors: string[];
  reason: "isbn" | "title";
};

export type CreateBookResult =
  | { ok: true; id: string }
  | { ok: false; error: string; duplicates?: DuplicateInfo[] };

const NOT_EDITOR = "Only owners and editors can change the library.";

function toDuplicateInfo(matches: DuplicateMatch[]): DuplicateInfo[] {
  return matches.map((m) => ({ id: m.book.id, title: m.book.title, authors: m.book.authors, reason: m.reason }));
}

function copyRow(copy: CopyInput, fallbackIsbn: string | null) {
  return {
    format: copy.format,
    condition: copy.condition,
    edition_isbn: copy.editionIsbn ?? fallbackIsbn,
    purchase_price: copy.purchasePrice,
    purchase_date: copy.purchaseDate,
  };
}

function revalidateBook(bookId: string) {
  revalidatePath(`/books/${bookId}`);
  revalidatePath("/library");
}

/** Read-only duplicate check, used by the add sheet before saving. */
export async function checkDuplicates(
  input: z.input<typeof duplicateCheckSchema>,
): Promise<ActionResult<{ duplicates: DuplicateInfo[] }>> {
  const parsed = duplicateCheckSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const user = await requireUser();
  const role = await roleInLibrary(parsed.data.libraryId, user.id);
  if (!role) return fail("You are not a member of that library.");

  const { libraryId, title, authors, isbn13 } = parsed.data;
  const existing = await loadDuplicateCandidates(libraryId, { title, isbn13: isbn13 ?? null });
  return { ok: true, duplicates: toDuplicateInfo(findDuplicates({ title, authors, isbn13: isbn13 ?? null }, existing)) };
}

export async function createBook(input: CreateBookInput): Promise<CreateBookResult> {
  const parsed = createBookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { libraryId, book, provider, copy, myStatus, force } = parsed.data;

  const user = await requireUser();
  const role = await roleInLibrary(libraryId, user.id);
  if (!canEdit(role)) return { ok: false, error: role ? NOT_EDITOR : "You are not a member of that library." };

  if (!force) {
    const existing = await loadDuplicateCandidates(libraryId, { title: book.title, isbn13: book.isbn13 });
    const matches = findDuplicates({ title: book.title, authors: book.authors, isbn13: book.isbn13 }, existing);
    if (matches.length > 0) {
      return { ok: false, error: "Already in your library.", duplicates: toDuplicateInfo(matches) };
    }
  }

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("books")
    .insert({
      library_id: libraryId,
      title: book.title,
      subtitle: book.subtitle,
      authors: book.authors,
      series_name: book.seriesName,
      series_position: book.seriesPosition,
      description: book.description,
      cover_url: book.coverUrl,
      page_count: book.pageCount,
      published_date: book.publishedDate,
      genres: book.genres,
      isbn13: book.isbn13,
      hardcover_id: provider.hardcoverId ?? null,
      google_books_id: provider.googleBooksId ?? null,
      ol_key: provider.olKey ?? null,
      public_rating: provider.publicRating ?? null,
      public_rating_count: provider.publicRatingCount ?? null,
      rating_source: provider.ratingSource ?? null,
      ownership: book.ownership,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Could not save the book." };

  if (book.ownership === "owned" && copy) {
    const { error: copyError } = await supabase
      .from("copies")
      .insert({ book_id: created.id, ...copyRow(copy, book.isbn13) });
    if (copyError) {
      await supabase.from("books").delete().eq("id", created.id);
      return { ok: false, error: copyError.message };
    }
  }

  const status = book.ownership === "wishlist" ? (myStatus ?? "want") : (myStatus ?? null);
  if (status) {
    await supabase.from("user_books").upsert({ user_id: user.id, book_id: created.id, status }, { onConflict: "user_id,book_id" });
  }

  revalidatePath("/library");
  return { ok: true, id: created.id };
}

export async function updateBook(input: z.input<typeof updateBookSchema>): Promise<ActionResult> {
  const parsed = updateBookSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const auth = await authorizeBook(parsed.data.bookId, true);
  if (!auth.ok) return fail(auth.error);

  const b = parsed.data.book;
  const { error } = await auth.supabase
    .from("books")
    .update({
      title: b.title,
      subtitle: b.subtitle,
      authors: b.authors,
      series_name: b.seriesName,
      series_position: b.seriesPosition,
      description: b.description,
      cover_url: b.coverUrl,
      page_count: b.pageCount,
      published_date: b.publishedDate,
      genres: b.genres,
      isbn13: b.isbn13,
      ownership: b.ownership,
    })
    .eq("id", parsed.data.bookId);
  if (error) return fail(error.message);
  revalidateBook(parsed.data.bookId);
  return { ok: true };
}

/** Sets only the cover (from the cover picker or an upload). */
export async function setCover(input: { bookId: string; coverUrl: string | null }): Promise<ActionResult> {
  const parsed = z
    .object({ bookId: z.string().uuid(), coverUrl: z.string().url().startsWith("https://").max(2000).nullable() })
    .safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const auth = await authorizeBook(parsed.data.bookId, true);
  if (!auth.ok) return fail(auth.error);
  const { error } = await auth.supabase.from("books").update({ cover_url: parsed.data.coverUrl }).eq("id", parsed.data.bookId);
  if (error) return fail(error.message);
  revalidateBook(parsed.data.bookId);
  return { ok: true };
}

export async function deleteBook(bookId: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(bookId);
  if (!parsed.success) return fail("That book id is not valid.");
  const auth = await authorizeBook(parsed.data, true);
  if (!auth.ok) return fail(auth.error);
  const { error } = await auth.supabase.from("books").delete().eq("id", parsed.data);
  if (error) return fail(error.message);
  revalidatePath("/library");
  return { ok: true };
}

/** Re-fetches provider data. Fills gaps and updates series, rating, description and ids; keeps the title, authors and chosen cover. */
export async function refreshMetadata(bookId: string): Promise<ActionResult<{ message: string }>> {
  const parsed = z.string().uuid().safeParse(bookId);
  if (!parsed.success) return fail("That book id is not valid.");
  const auth = await authorizeBook(parsed.data, true);
  if (!auth.ok) return fail(auth.error);

  const { data: current } = await auth.supabase.from("books").select("*").eq("id", parsed.data).single();
  if (!current) return fail("That book is not in your library.");

  const fresh = await refreshFor({ title: current.title, authors: current.authors ?? [], isbn13: current.isbn13 });
  if (!fresh) return fail("No provider returned a match. Try again later, or edit the details by hand.");

  const patch: Record<string, unknown> = {};
  const fill = (column: string, value: unknown, empty: boolean) => {
    if (value !== null && value !== undefined && value !== "" && empty) patch[column] = value;
  };
  fill("subtitle", fresh.subtitle, !current.subtitle);
  fill("authors", fresh.authors.length ? fresh.authors : null, !current.authors?.length);
  fill("description", fresh.description, true);
  fill("page_count", fresh.pageCount, !current.page_count);
  fill("published_date", fresh.publishedDate, !current.published_date);
  fill("genres", fresh.genres.length ? fresh.genres : null, !current.genres?.length);
  fill("isbn13", fresh.isbn13, !current.isbn13);
  fill("cover_url", fresh.covers[0]?.url, !current.cover_url);
  if (fresh.seriesName) {
    patch.series_name = fresh.seriesName;
    patch.series_position = fresh.seriesPosition;
  }
  if (fresh.rating) {
    patch.public_rating = fresh.rating.value;
    patch.public_rating_count = fresh.rating.count;
    patch.rating_source = fresh.rating.source;
  }
  if (fresh.ids.hardcover) patch.hardcover_id = fresh.ids.hardcover;
  if (fresh.ids.google) patch.google_books_id = fresh.ids.google;
  if (fresh.ids.openLibrary) patch.ol_key = fresh.ids.openLibrary;

  if (Object.keys(patch).length === 0) return { ok: true, message: "Already up to date." };
  const { error } = await auth.supabase.from("books").update(patch).eq("id", parsed.data);
  if (error) return fail(error.message);
  revalidateBook(parsed.data);
  return { ok: true, message: `Updated from ${fresh.providers.join(", ")}.` };
}

// ---------------------------------------------------------------- copies

export async function addCopy(input: z.input<typeof copyActionSchema>): Promise<ActionResult> {
  const parsed = copyActionSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const auth = await authorizeBook(parsed.data.bookId, true);
  if (!auth.ok) return fail(auth.error);

  const { error } = await auth.supabase
    .from("copies")
    .insert({ book_id: parsed.data.bookId, ...copyRow(parsed.data.copy, auth.book.isbn13) });
  if (error) return fail(error.message);
  // Owning a copy means the book is no longer just on the wishlist.
  await auth.supabase.from("books").update({ ownership: "owned" }).eq("id", parsed.data.bookId).eq("ownership", "wishlist");
  revalidateBook(parsed.data.bookId);
  return { ok: true };
}

async function authorizeCopy(copyId: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: copy } = await supabase.from("copies").select("id, book_id").eq("id", copyId).maybeSingle();
  if (!copy) return { ok: false as const, error: "That copy does not exist." };
  const auth = await authorizeBook(copy.book_id, true);
  if (!auth.ok) return { ok: false as const, error: auth.error };
  return { ok: true as const, supabase, bookId: copy.book_id as string, user };
}

export async function updateCopy(input: z.input<typeof updateCopySchema>): Promise<ActionResult> {
  const parsed = updateCopySchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const auth = await authorizeCopy(parsed.data.copyId);
  if (!auth.ok) return fail(auth.error);
  const c = parsed.data.copy;
  const { error } = await auth.supabase
    .from("copies")
    .update({
      format: c.format,
      condition: c.condition,
      edition_isbn: c.editionIsbn,
      purchase_price: c.purchasePrice,
      purchase_date: c.purchaseDate,
    })
    .eq("id", parsed.data.copyId);
  if (error) return fail(error.message);
  revalidateBook(auth.bookId);
  return { ok: true };
}

export async function deleteCopy(copyId: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(copyId);
  if (!parsed.success) return fail("That copy id is not valid.");
  const auth = await authorizeCopy(parsed.data);
  if (!auth.ok) return fail(auth.error);
  const { error } = await auth.supabase.from("copies").delete().eq("id", parsed.data);
  if (error) return fail(error.message);
  revalidateBook(auth.bookId);
  return { ok: true };
}

// ------------------------------------------------- my status, rating, notes

/** Upserts only the fields given. Any member may do this for themselves (RLS pins user_id). */
export async function saveMyBook(input: z.input<typeof myBookSchema>): Promise<ActionResult> {
  const parsed = myBookSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const auth = await authorizeBook(parsed.data.bookId, false);
  if (!auth.ok) return fail(auth.error);

  const row: Record<string, unknown> = { user_id: auth.user.id, book_id: parsed.data.bookId };
  if (parsed.data.status !== undefined) row.status = parsed.data.status;
  if (parsed.data.rating !== undefined) row.rating = parsed.data.rating;
  if (parsed.data.notes !== undefined) row.notes = parsed.data.notes?.trim() ? parsed.data.notes : null;

  const { error } = await auth.supabase.from("user_books").upsert(row, { onConflict: "user_id,book_id" });
  if (error) return fail(error.message);
  revalidateBook(parsed.data.bookId);
  return { ok: true };
}

// ----------------------------------------------------------------- reads

export async function addRead(input: z.input<typeof addReadSchema>): Promise<ActionResult> {
  const parsed = addReadSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const auth = await authorizeBook(parsed.data.bookId, false);
  if (!auth.ok) return fail(auth.error);

  const { startedAt, finishedAt } = parsed.data.read;
  const { error } = await auth.supabase
    .from("reads")
    .insert({ user_id: auth.user.id, book_id: parsed.data.bookId, started_at: startedAt, finished_at: finishedAt });
  if (error) return fail(error.message);

  // Logging a finished read moves a "want" or "reading" status on to "read".
  if (finishedAt) {
    const { data: ub } = await auth.supabase
      .from("user_books")
      .select("status")
      .eq("user_id", auth.user.id)
      .eq("book_id", parsed.data.bookId)
      .maybeSingle();
    if (!ub || ub.status === "want" || ub.status === "reading") {
      await auth.supabase
        .from("user_books")
        .upsert({ user_id: auth.user.id, book_id: parsed.data.bookId, status: "read" }, { onConflict: "user_id,book_id" });
    }
  }
  revalidateBook(parsed.data.bookId);
  return { ok: true };
}

async function ownRead(readId: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("reads").select("id, book_id, user_id").eq("id", readId).maybeSingle();
  if (!data || data.user_id !== user.id) return { ok: false as const, error: "That read is not yours to change." };
  return { ok: true as const, supabase, bookId: data.book_id as string };
}

export async function updateRead(input: z.input<typeof updateReadSchema>): Promise<ActionResult> {
  const parsed = updateReadSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const own = await ownRead(parsed.data.readId);
  if (!own.ok) return fail(own.error);
  const { error } = await own.supabase
    .from("reads")
    .update({ started_at: parsed.data.read.startedAt, finished_at: parsed.data.read.finishedAt })
    .eq("id", parsed.data.readId);
  if (error) return fail(error.message);
  revalidateBook(own.bookId);
  return { ok: true };
}

export async function deleteRead(readId: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(readId);
  if (!parsed.success) return fail("That read id is not valid.");
  const own = await ownRead(parsed.data);
  if (!own.ok) return fail(own.error);
  const { error } = await own.supabase.from("reads").delete().eq("id", parsed.data);
  if (error) return fail(error.message);
  revalidateBook(own.bookId);
  return { ok: true };
}
