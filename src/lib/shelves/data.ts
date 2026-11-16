import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLibraryItems } from "@/lib/books/data";
import { createClient } from "@/lib/supabase/server";
import { buildReadingGroups, buildShelfRows, shelfBooks, sortShelves } from "./content";
import type { ShelfColor, ShelfIconKey, ShelfKind, ShelfSort, ShelfVisibility } from "./constants";
import { SHELF_COLORS, SHELF_ICON_KEYS } from "./constants";
import { readRules } from "./rules";
import type { ReadingGroup, Shelf, ShelfBookRef, ShelfRowData } from "./types";
import type { LibraryItem } from "@/lib/books/library-query";

const PAGE = 1000;
const COLUMNS = "id, library_id, name, color, icon, visibility, kind, rules, sort, sort_order, created_by, created_at";

type Row = Record<string, unknown>;

export function toShelf(r: Row): Shelf {
  const color = r.color as string;
  const icon = r.icon as string | null;
  return {
    id: r.id as string,
    libraryId: r.library_id as string,
    name: r.name as string,
    color: ((SHELF_COLORS as readonly string[]).includes(color) ? color : "spine-1") as ShelfColor,
    icon: icon && (SHELF_ICON_KEYS as readonly string[]).includes(icon) ? (icon as ShelfIconKey) : null,
    visibility: r.visibility as ShelfVisibility,
    kind: r.kind as ShelfKind,
    rules: r.kind === "smart" ? readRules(r.rules) : null,
    sort: r.sort as ShelfSort,
    sortOrder: Number(r.sort_order),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/** Shelves the signed-in user can see (RLS hides other people's private ones), in row order. */
export async function loadShelves(libraryId: string, supabase?: SupabaseClient): Promise<Shelf[]> {
  const db = supabase ?? (await createClient());
  const { data, error } = await db.from("shelves").select(COLUMNS).eq("library_id", libraryId);
  if (error) throw new Error(error.message);
  return sortShelves((data ?? []).map((r) => toShelf(r as Row)));
}

export async function loadShelf(shelfId: string): Promise<Shelf | null> {
  const db = await createClient();
  const { data } = await db.from("shelves").select(COLUMNS).eq("id", shelfId).maybeSingle();
  return data ? toShelf(data as Row) : null;
}

/** shelf_books rows for some shelves, paged past the API row limit. One query per 1000 rows. */
export async function loadShelfBookRefs(shelfIds: string[]): Promise<ShelfBookRef[]> {
  if (shelfIds.length === 0) return [];
  const db = await createClient();
  const out: ShelfBookRef[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("shelf_books")
      .select("shelf_id, book_id, position")
      .in("shelf_id", shelfIds)
      .order("shelf_id")
      .order("book_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) out.push({ shelfId: r.shelf_id as string, bookId: r.book_id as string, position: Number(r.position) });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function loadMemberNames(libraryId: string): Promise<Map<string, string>> {
  const db = await createClient();
  const { data } = await db
    .from("library_members")
    .select("user_id, profiles(display_name, email)")
    .eq("library_id", libraryId);
  const names = new Map<string, string>();
  for (const m of (data ?? []) as unknown as { user_id: string; profiles: { display_name: string | null; email: string | null } | { display_name: string | null; email: string | null }[] | null }[]) {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    names.set(m.user_id, p?.display_name?.trim() || p?.email?.split("@")[0] || "Member");
  }
  return names;
}

export type ShelvesOverview = {
  rows: ShelfRowData[];
  reading: ReadingGroup[];
  bookCount: number;
};

/**
 * Everything the shelves page needs in four bounded queries (shelves, memberships, books with their
 * statuses, member names), however many shelves there are. Rows are assembled in memory.
 */
export async function loadShelvesOverview(libraryId: string, userId: string): Promise<ShelvesOverview> {
  const [shelves, items, names] = await Promise.all([loadShelves(libraryId), loadLibraryItems(libraryId, userId), loadMemberNames(libraryId)]);
  const refs = await loadShelfBookRefs(shelves.filter((s) => s.kind === "manual").map((s) => s.id));
  return {
    rows: buildShelfRows(shelves, items, refs),
    reading: buildReadingGroups(items, names, userId),
    bookCount: items.length,
  };
}

export type ShelfDetailData = { shelf: Shelf; books: LibraryItem[]; positions: Map<string, number> };

export async function loadShelfDetail(shelf: Shelf, userId: string): Promise<ShelfDetailData> {
  const [items, refs] = await Promise.all([
    loadLibraryItems(shelf.libraryId, userId),
    shelf.kind === "manual" ? loadShelfBookRefs([shelf.id]) : Promise.resolve([] as ShelfBookRef[]),
  ]);
  return {
    shelf,
    books: shelfBooks(shelf, items, refs),
    positions: new Map(refs.map((r) => [r.bookId, r.position])),
  };
}

export type BookShelf = { id: string; name: string; color: ShelfColor; icon: string | null; visibility: ShelfVisibility; createdBy: string | null; kind: ShelfKind };

/** The manual shelves a book is on, among those the user can see. Two queries. */
export async function loadShelvesForBook(bookId: string): Promise<BookShelf[]> {
  const db = await createClient();
  const { data: refs } = await db.from("shelf_books").select("shelf_id").eq("book_id", bookId);
  const ids = (refs ?? []).map((r) => r.shelf_id as string);
  if (ids.length === 0) return [];
  const { data } = await db.from("shelves").select(COLUMNS).in("id", ids);
  return sortShelves((data ?? []).map((r) => toShelf(r as Row))).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    icon: s.icon,
    visibility: s.visibility,
    createdBy: s.createdBy,
    kind: s.kind,
  }));
}
