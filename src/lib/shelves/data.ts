import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countLibraryBooks, loadLibraryItemsByIds, loadLibraryPageIds, loadLibraryPageItems } from "@/lib/books/data";
import { PAGE_SIZE, type LibraryItem } from "@/lib/books/library-query";
import { createClient } from "@/lib/supabase/server";
import { buildReadingGroups, idsByPosition, readingCoverIds, sortShelves, toCover, type ReadingRow } from "./content";
import type { ShelfColor, ShelfIconKey, ShelfKind, ShelfSort, ShelfVisibility } from "./constants";
import { ROW_COVERS, SHELF_COLORS, SHELF_ICON_KEYS } from "./constants";
import { paramsFromRules, readRules } from "./rules";
import type { ReadingGroup, Shelf, ShelfBookRef, ShelfRowData } from "./types";

const PAGE = 1000;
/** The most rows one library_page call returns. */
const LIBRARY_PAGE_MAX = 1000;
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

/** The library params a manual shelf's own sort stands for (it has no filters). Custom order has none: positions decide. */
const manualParams = (sort: ShelfSort) => paramsFromRules({}, sort);

/** One manual shelf's book ids in the shelf's sort, from its memberships. `limit` caps how many come back. */
async function manualShelfIds(libraryId: string, shelf: Shelf, refs: ShelfBookRef[], limit: number): Promise<string[]> {
  if (refs.length === 0) return [];
  if (shelf.sort === "custom") return idsByPosition(refs).slice(0, limit);
  const out: string[] = [];
  // library_page returns at most 1000 rows a call; walk the shelf in pages.
  for (let offset = 0; out.length < limit; offset += LIBRARY_PAGE_MAX) {
    const { ids } = await loadLibraryPageIds(libraryId, manualParams(shelf.sort), { offset, limit: Math.min(LIBRARY_PAGE_MAX, limit - out.length), bookIds: refs.map((r) => r.bookId) });
    out.push(...ids);
    if (ids.length < LIBRARY_PAGE_MAX) break;
  }
  return out.slice(0, limit);
}

/** Every "reading" status in a library, with the book's age for ordering. Bounded by what people are reading now. */
async function loadReadingRows(libraryId: string): Promise<ReadingRow[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("user_books")
    .select("user_id, book_id, books!inner(created_at, library_id)")
    .eq("status", "reading")
    .eq("books.library_id", libraryId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { user_id: string; book_id: string; books: { created_at: string } | { created_at: string }[] }[]).map((r) => ({
    userId: r.user_id,
    bookId: r.book_id,
    createdAt: (Array.isArray(r.books) ? r.books[0] : r.books).created_at,
  }));
}

/**
 * Everything the shelves page needs without reading the library: the shelves, the manual memberships, who is reading
 * what, then per shelf only the ids of the covers shown (smart shelves ask the database for a count and the first
 * covers, manual shelves share one membership query), and one details query for just those covers.
 */
export async function loadShelvesOverview(libraryId: string, userId: string): Promise<ShelvesOverview> {
  const [shelves, names, readingRows, bookCount] = await Promise.all([loadShelves(libraryId), loadMemberNames(libraryId), loadReadingRows(libraryId), countLibraryBooks(libraryId)]);
  const refs = await loadShelfBookRefs(shelves.filter((s) => s.kind === "manual").map((s) => s.id));
  const refsByShelf = new Map<string, ShelfBookRef[]>();
  for (const r of refs) refsByShelf.set(r.shelfId, [...(refsByShelf.get(r.shelfId) ?? []), r]);

  const parts = await Promise.all(
    shelves.map(async (shelf) => {
      if (shelf.kind === "smart") {
        const { ids, total } = await loadLibraryPageIds(libraryId, paramsFromRules(shelf.rules ?? {}, shelf.sort), { limit: ROW_COVERS });
        return { shelf, count: total, ids };
      }
      const mine = refsByShelf.get(shelf.id) ?? [];
      return { shelf, count: mine.length, ids: await manualShelfIds(libraryId, shelf, mine, ROW_COVERS) };
    }),
  );

  const covers = await loadLibraryItemsByIds([...new Set([...parts.flatMap((p) => p.ids), ...readingCoverIds(readingRows)])], userId);
  const byId = new Map(covers.map((i) => [i.id, i]));
  return {
    rows: parts.map((p) => ({
      shelf: p.shelf,
      count: p.count,
      covers: p.ids.map((id) => byId.get(id)).filter((i): i is LibraryItem => !!i).map(toCover),
    })),
    reading: buildReadingGroups(readingRows, byId, names, userId),
    bookCount,
  };
}

export type ShelfDetailData = {
  shelf: Shelf;
  books: LibraryItem[];
  /** Every book on the shelf. A smart shelf may hold more than `books`; the rest load as the person scrolls. */
  total: number;
  hasMore: boolean;
};

/**
 * A shelf's books. A smart shelf loads its first page (the library list's own paging, see library_page) and the rest
 * through loadSmartShelfPage. A manual shelf loads all of its books, because arranging and selecting need the whole
 * shelf; that is bounded by the shelf, not the library.
 */
export async function loadShelfDetail(shelf: Shelf, userId: string): Promise<ShelfDetailData> {
  if (shelf.kind === "smart") {
    const { items, total } = await loadLibraryPageItems(shelf.libraryId, userId, paramsFromRules(shelf.rules ?? {}, shelf.sort), { limit: PAGE_SIZE });
    return { shelf, books: items, total, hasMore: total > items.length };
  }
  const refs = await loadShelfBookRefs([shelf.id]);
  const books = await loadLibraryItemsByIds(await manualShelfIds(shelf.libraryId, shelf, refs, Number.MAX_SAFE_INTEGER), userId);
  return { shelf, books, total: books.length, hasMore: false };
}

/** Another page of a smart shelf's books. */
export async function loadSmartShelfPage(shelf: Shelf, userId: string, offset: number): Promise<{ items: LibraryItem[]; total: number; hasMore: boolean }> {
  const { items, total } = await loadLibraryPageItems(shelf.libraryId, userId, paramsFromRules(shelf.rules ?? {}, shelf.sort), { offset, limit: PAGE_SIZE });
  return { items, total, hasMore: offset + PAGE_SIZE < total };
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
