"use server";

import { revalidatePath } from "next/cache";
import { fail, firstIssue, roleInLibrary, type ActionResult } from "@/lib/books/access";
import { requireUser, type LibraryRole } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";
import { attachBooksToShelves } from "@/lib/shelves/assign";
import type { ShelfColor, ShelfVisibility } from "@/lib/shelves/constants";
import { loadShelf, loadShelfBookRefs, loadShelves } from "@/lib/shelves/data";
import { canChangeShelfBooks, canCreateShelf, canEditShelf, canWriteShelf } from "@/lib/shelves/permissions";
import { GAP, planMove, planReorder } from "@/lib/shelves/positions";
import {
  createShelfSchema,
  moveShelfBookSchema,
  removeFromShelfSchema,
  reorderShelvesSchema,
  shelfBooksSchema,
  updateShelfSchema,
  type CreateShelfInput,
  type UpdateShelfInput,
} from "@/lib/shelves/schemas";
import type { z } from "zod";

const NOT_MEMBER = "You are not a member of that library.";
const NOT_YOURS = "You can't change that shelf.";
const NO_SHARED = "Only owners and editors can make shared shelves. You can make a private one.";

function revalidateShelf(shelfId?: string) {
  revalidatePath("/shelves");
  if (shelfId) revalidatePath(`/shelves/${shelfId}`);
}

/** Loads a shelf through RLS and the caller's role in its library. */
async function shelfAndRole(shelfId: string) {
  const user = await requireUser();
  const shelf = await loadShelf(shelfId);
  if (!shelf) return { ok: false as const, error: "That shelf does not exist, or it is private to someone else." };
  const role = await roleInLibrary(shelf.libraryId, user.id);
  if (!role) return { ok: false as const, error: NOT_MEMBER };
  return { ok: true as const, user, shelf, role };
}

export async function createShelf(input: CreateShelfInput): Promise<ActionResult<{ id: string }>> {
  const parsed = createShelfSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  const user = await requireUser();
  const role = await roleInLibrary(v.libraryId, user.id);
  if (!role) return fail(NOT_MEMBER);
  if (!canCreateShelf(role, v.visibility)) return fail(NO_SHARED);

  const supabase = await createClient();
  const existing = await loadShelves(v.libraryId, supabase);
  const last = existing.reduce((m, s) => Math.max(m, s.sortOrder), 0);
  const { data, error } = await supabase
    .from("shelves")
    .insert({
      library_id: v.libraryId,
      name: v.name,
      visibility: v.visibility,
      color: v.color,
      icon: v.icon,
      sort: v.rules && v.sort === "custom" ? "series" : v.sort,
      kind: v.rules ? "smart" : "manual",
      rules: v.rules,
      sort_order: last + GAP,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not create the shelf.");
  revalidateShelf(data.id);
  return { ok: true, id: data.id };
}

export async function updateShelf(input: UpdateShelfInput): Promise<ActionResult> {
  const parsed = updateShelfSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const auth = await shelfAndRole(v.shelfId);
  if (!auth.ok) return fail(auth.error);
  const { shelf, role, user } = auth;

  const nextVisibility: ShelfVisibility = v.visibility ?? shelf.visibility;
  if (!canEditShelf(role, user.id, shelf, nextVisibility)) {
    return fail(nextVisibility === "shared" && shelf.visibility === "private" ? NO_SHARED : NOT_YOURS);
  }
  if (v.rules && shelf.kind !== "smart") return fail("Only smart shelves have rules.");
  const nextSort = v.sort ?? shelf.sort;
  if (shelf.kind === "smart" && nextSort === "custom") return fail("A smart shelf cannot use your own order.");

  const patch: Record<string, unknown> = {};
  if (v.name !== undefined) patch.name = v.name;
  if (v.visibility !== undefined) patch.visibility = v.visibility;
  if (v.color !== undefined) patch.color = v.color;
  if (v.icon !== undefined) patch.icon = v.icon;
  if (v.sort !== undefined) patch.sort = v.sort;
  if (v.rules !== undefined) patch.rules = v.rules;
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.from("shelves").update(patch).eq("id", v.shelfId);
  if (error) return fail(error.message);
  revalidateShelf(v.shelfId);
  return { ok: true };
}

export async function deleteShelf(shelfId: string): Promise<ActionResult> {
  const id = /^[0-9a-f-]{36}$/i.test(shelfId) ? shelfId : null;
  if (!id) return fail("That shelf id is not valid.");
  const auth = await shelfAndRole(id);
  if (!auth.ok) return fail(auth.error);
  if (!canWriteShelf(auth.role, auth.user.id, auth.shelf)) return fail(NOT_YOURS);
  const supabase = await createClient();
  const { error } = await supabase.from("shelves").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/shelves");
  return { ok: true };
}

/**
 * Saves a new row order. `ids` is the order the person sees (shared shelves plus their own private ones).
 * A single moved row writes one sort_order; otherwise the visible rows are renumbered.
 */
export async function reorderShelves(input: z.input<typeof reorderShelvesSchema>): Promise<ActionResult> {
  const parsed = reorderShelvesSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { libraryId, ids } = parsed.data;
  const user = await requireUser();
  const role = await roleInLibrary(libraryId, user.id);
  if (!role) return fail(NOT_MEMBER);

  const supabase = await createClient();
  const shelves = await loadShelves(libraryId, supabase);
  const plan = planReorder(
    shelves.map((s) => ({ id: s.id, pos: s.sortOrder })),
    ids,
  );
  if (plan.updates.length === 0) return { ok: true };

  const byId = new Map(shelves.map((s) => [s.id, s]));
  const blocked = plan.updates.some((u) => !canWriteShelf(role, user.id, byId.get(u.id)!));
  if (blocked) {
    return fail(
      plan.renormalized
        ? "The rows need tidying, which only an owner or editor can do. Ask one to move a shelf first."
        : "Only owners and editors can move shared shelves. You can move your own private ones.",
    );
  }
  const results = await Promise.all(plan.updates.map((u) => supabase.from("shelves").update({ sort_order: u.pos }).eq("id", u.id)));
  const bad = results.find((r) => r.error);
  if (bad?.error) return fail(bad.error.message);
  revalidatePath("/shelves");
  return { ok: true };
}

/** Puts books on manual shelves. All shelves must be in one library, which the books must belong to. */
export async function addBooksToShelves(input: z.input<typeof shelfBooksSchema>): Promise<ActionResult<{ added: number; skipped: number }>> {
  const parsed = shelfBooksSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { shelfIds, bookIds } = parsed.data;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: shelfRows } = await supabase.from("shelves").select("id, library_id").in("id", shelfIds);
  const libs = new Set((shelfRows ?? []).map((s) => s.library_id as string));
  if ((shelfRows ?? []).length === 0) return fail("Those shelves could not be found.");
  if (libs.size !== 1) return fail("Choose shelves from one library.");
  const libraryId = [...libs][0];
  const role = await roleInLibrary(libraryId, user.id);
  if (!role) return fail(NOT_MEMBER);

  const { data: books } = await supabase.from("books").select("id").eq("library_id", libraryId).in("id", bookIds);
  const valid = (books ?? []).map((b) => b.id as string);
  if (valid.length === 0) return fail("Those books are not in this library.");

  const result = await attachBooksToShelves(supabase, { userId: user.id, role, libraryId, shelfIds, bookIds: valid });
  if (result.added === 0 && result.skipped === shelfIds.length) return fail("You can't put books on those shelves.");
  revalidatePath("/shelves");
  for (const id of shelfIds) revalidatePath(`/shelves/${id}`);
  if (valid.length <= 5) for (const id of valid) revalidatePath(`/books/${id}`);
  return { ok: true, ...result };
}

export async function removeBooksFromShelf(input: z.input<typeof removeFromShelfSchema>): Promise<ActionResult> {
  const parsed = removeFromShelfSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const auth = await shelfAndRole(parsed.data.shelfId);
  if (!auth.ok) return fail(auth.error);
  if (!canChangeShelfBooks(auth.role, auth.user.id, auth.shelf)) {
    return fail(auth.shelf.kind === "smart" ? "A smart shelf fills itself from its rules." : NOT_YOURS);
  }
  const supabase = await createClient();
  const { error } = await supabase.from("shelf_books").delete().eq("shelf_id", parsed.data.shelfId).in("book_id", parsed.data.bookIds);
  if (error) return fail(error.message);
  revalidateShelf(parsed.data.shelfId);
  if (parsed.data.bookIds.length <= 5) for (const id of parsed.data.bookIds) revalidatePath(`/books/${id}`);
  return { ok: true };
}

/** Moves one book to index `toIndex` of a custom-ordered shelf, writing one position when it can. */
export async function moveShelfBook(input: z.input<typeof moveShelfBookSchema>): Promise<ActionResult> {
  const parsed = moveShelfBookSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { shelfId, bookId, toIndex } = parsed.data;
  const auth = await shelfAndRole(shelfId);
  if (!auth.ok) return fail(auth.error);
  if (!canChangeShelfBooks(auth.role, auth.user.id, auth.shelf)) return fail(NOT_YOURS);
  if (auth.shelf.sort !== "custom") return fail("Switch the shelf to your own order first.");

  const refs = await loadShelfBookRefs([shelfId]);
  const plan = planMove(
    refs.map((r) => ({ id: r.bookId, pos: r.position })),
    bookId,
    toIndex,
  );
  if (plan.updates.length === 0) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase
    .from("shelf_books")
    .upsert(plan.updates.map((u) => ({ shelf_id: shelfId, book_id: u.id, position: u.pos })), { onConflict: "shelf_id,book_id" });
  if (error) return fail(error.message);
  revalidateShelf(shelfId);
  return { ok: true };
}

export type AssignableShelf = { id: string; name: string; color: ShelfColor; icon: string | null; visibility: ShelfVisibility };

/** The manual shelves this person may put books on, for the pickers. */
export async function listAssignableShelves(libraryId: string): Promise<ActionResult<{ role: LibraryRole; shelves: AssignableShelf[] }>> {
  if (!/^[0-9a-f-]{36}$/i.test(libraryId)) return fail("That library id is not valid.");
  const user = await requireUser();
  const role = await roleInLibrary(libraryId, user.id);
  if (!role) return fail(NOT_MEMBER);
  const shelves = (await loadShelves(libraryId))
    .filter((s) => canChangeShelfBooks(role, user.id, s))
    .map((s) => ({ id: s.id, name: s.name, color: s.color, icon: s.icon, visibility: s.visibility }));
  return { ok: true, role, shelves };
}
