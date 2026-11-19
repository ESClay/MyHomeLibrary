"use server";

import { z } from "zod";
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
