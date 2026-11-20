"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit } from "@/lib/books/access";
import { loadLibraryPageItems } from "@/lib/books/data";
import { PAGE_SIZE, SORTS, parseLibraryParams, paramsToRaw, type LibraryItem, type LibraryParams } from "@/lib/books/library-query";
import { getLibraryContext, requireUser } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";

export type LibraryPageResult = { ok: true; items: LibraryItem[]; hasMore: boolean; total: number } | { ok: false; error: string };

/**
 * One more page of the library list, for infinite scroll (the filter and sort run in the database, see library_page). Membership is checked the way the page does it: the library
 * must be one of the signed-in person's own, and the data is read through their client (RLS). The params are re-parsed,
 * so a tampered value falls back to a default.
 */
export async function loadLibraryPage(input: { libraryId: string; params: LibraryParams; offset: number }): Promise<LibraryPageResult> {
  const offset = Number.isFinite(input.offset) ? Math.max(0, Math.floor(input.offset)) : 0;
  try {
    const { user, libraries } = await getLibraryContext();
    if (!libraries.some((l) => l.id === input.libraryId)) return { ok: false, error: "That library is not yours." };
    const params = parseLibraryParams(paramsToRaw(input.params));
    const { items, total } = await loadLibraryPageItems(input.libraryId, user.id, params, { offset, limit: PAGE_SIZE });
    return { ok: true, items, hasMore: offset + PAGE_SIZE < total, total };
  } catch {
    return { ok: false, error: "Could not load more books." };
  }
}

const sortSchema = z.object({ sort: z.enum(SORTS), dir: z.enum(["asc", "desc"]) });

/** Saves the library sort on the caller's own profile (one setting per person, for every library and device). */
export async function saveLibrarySort(input: { sort: string; dir: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = sortSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That sort is not available." };
  try {
    const user = await requireUser();
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ library_sort: parsed.data.sort, library_sort_dir: parsed.data.dir })
      .eq("id", user.id);
    if (error) return { ok: false, error: "Could not save the sort." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the sort." };
  }
}

const nameField = z.string().trim().min(1, "Enter a series name.").max(200, "A series name can be 200 characters at most.");
const renameSchema = z
  .object({ libraryId: z.string().uuid(), from: nameField, to: nameField, author: z.string().trim().max(200).optional() })
  .refine((v) => v.to !== v.from, { message: "That is already the series name.", path: ["to"] });

/**
 * Renames a series across a library (also merges two spellings into one). Owners and editors only. The match is
 * case- and accent-insensitive and, when `author` is given, limited to books whose first author has that last name;
 * both run in the `library_rename_series` SQL function so it is one statement using the same folding as the library search.
 */
export async function renameSeries(input: {
  libraryId: string;
  from: string;
  to: string;
  author?: string;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the series name." };
  try {
    const { libraries } = await getLibraryContext();
    const library = libraries.find((l) => l.id === parsed.data.libraryId);
    if (!library) return { ok: false, error: "That library is not yours." };
    if (!canEdit(library.role)) return { ok: false, error: "Only owners and editors can change the library." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("library_rename_series", {
      p_library_id: parsed.data.libraryId,
      p_from: parsed.data.from,
      p_to: parsed.data.to,
      p_author: parsed.data.author || null,
    });
    if (error) return { ok: false, error: "Could not rename the series." };
    revalidatePath("/library");
    return { ok: true, count: Number(data ?? 0) };
  } catch {
    return { ok: false, error: "Could not rename the series." };
  }
}

const authorField = z.string().trim().min(1, "Enter an author name.").max(200, "An author name can be 200 characters at most.");
const authorSchema = z.object({ libraryId: z.string().uuid(), from: authorField, to: authorField }).refine((v) => v.to !== v.from, {
  message: "That is already the spelling.",
  path: ["to"],
});

/**
 * Changes how an author is spelled across a library. Every book listing the author (in any position) gets the new
 * spelling; the match ignores case, accents, punctuation and spacing, so "Gail Z Martin" finds "Gail Z. Martin". The match
 * runs in the `library_rename_author` SQL function. Owners and editors only.
 */
export async function renameAuthor(input: { libraryId: string; from: string; to: string }): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = authorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the author name." };
  try {
    const { libraries } = await getLibraryContext();
    const library = libraries.find((l) => l.id === parsed.data.libraryId);
    if (!library) return { ok: false, error: "That library is not yours." };
    if (!canEdit(library.role)) return { ok: false, error: "Only owners and editors can change the library." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("library_rename_author", {
      p_library_id: parsed.data.libraryId,
      p_from: parsed.data.from,
      p_to: parsed.data.to,
    });
    if (error) return { ok: false, error: "Could not change the spelling." };
    revalidatePath("/library");
    revalidatePath("/books/[id]", "page");
    return { ok: true, count: Number(data ?? 0) };
  } catch {
    return { ok: false, error: "Could not change the spelling." };
  }
}
