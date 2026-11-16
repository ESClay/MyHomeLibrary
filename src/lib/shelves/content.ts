import {
  applyLibraryQuery,
  compareItems,
  defaultDir,
  type LibraryItem,
} from "@/lib/books/library-query";
import { primaryLoan } from "@/lib/loans/rules";
import { ROW_COVERS, SHELF_SORT_TO_LIBRARY, type ShelfSort } from "./constants";
import { paramsFromRules } from "./rules";
import type { CoverLite, ReadingGroup, Shelf, ShelfBookRef, ShelfRowData } from "./types";

export const toCover = (i: LibraryItem): CoverLite => ({
  id: i.id,
  title: i.title,
  author: i.authors[0] ?? null,
  coverUrl: i.coverUrl,
  loan: primaryLoan(i.loans),
});

/** A manual shelf's books in the shelf's sort. `custom` follows the stored positions. */
export function orderManual(items: LibraryItem[], refs: Pick<ShelfBookRef, "bookId" | "position">[], sort: ShelfSort): LibraryItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const pos = new Map(refs.map((r) => [r.bookId, r.position]));
  const books = refs.map((r) => byId.get(r.bookId)).filter((i): i is LibraryItem => !!i);
  if (sort === "custom") {
    return books.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1));
  }
  const lib = SHELF_SORT_TO_LIBRARY[sort];
  return books.sort((a, b) => compareItems(a, b, lib, defaultDir(lib)));
}

/**
 * A smart shelf's books. This is the library list's own filter and sort (applyLibraryQuery),
 * fed the shelf's rules as library params, so the two can never disagree.
 * "My status" resolves for whoever's items these are.
 */
export function evaluateSmart(items: LibraryItem[], shelf: Pick<Shelf, "rules" | "sort">): LibraryItem[] {
  return applyLibraryQuery(items, paramsFromRules(shelf.rules ?? {}, shelf.sort));
}

export function shelfBooks(shelf: Shelf, items: LibraryItem[], refs: ShelfBookRef[]): LibraryItem[] {
  return shelf.kind === "smart"
    ? evaluateSmart(items, shelf)
    : orderManual(
        items,
        refs.filter((r) => r.shelfId === shelf.id),
        shelf.sort,
      );
}

/** Rows for the shelves page: one pass over the data already loaded, no per-shelf queries. */
export function buildShelfRows(shelves: Shelf[], items: LibraryItem[], refs: ShelfBookRef[]): ShelfRowData[] {
  const byShelf = new Map<string, ShelfBookRef[]>();
  for (const r of refs) {
    const list = byShelf.get(r.shelfId);
    if (list) list.push(r);
    else byShelf.set(r.shelfId, [r]);
  }
  return shelves.map((shelf) => {
    const books =
      shelf.kind === "smart" ? evaluateSmart(items, shelf) : orderManual(items, byShelf.get(shelf.id) ?? [], shelf.sort);
    return { shelf, count: books.length, covers: books.slice(0, ROW_COVERS).map(toCover) };
  });
}

/** Every member's books with status "reading", me first. Groups with no books are left out. */
export function buildReadingGroups(
  items: LibraryItem[],
  names: Map<string, string>,
  userId: string,
): ReadingGroup[] {
  const groups = new Map<string, LibraryItem[]>();
  const add = (uid: string, item: LibraryItem) => {
    const list = groups.get(uid);
    if (list) list.push(item);
    else groups.set(uid, [item]);
  };
  for (const item of items) {
    if (item.mine?.status === "reading") add(userId, item);
    for (const o of item.others) if (o.status === "reading") add(o.userId, item);
  }
  const out: ReadingGroup[] = [];
  for (const [uid, list] of groups) {
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    out.push({
      userId: uid,
      name: uid === userId ? (names.get(uid) ?? "You") : (names.get(uid) ?? "Member"),
      isMe: uid === userId,
      count: list.length,
      covers: list.slice(0, ROW_COVERS).map(toCover),
    });
  }
  return out.sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, "en"));
}

/** The order shelves are shown in: sort_order, then age, then id. */
export function sortShelves<T extends Pick<Shelf, "id" | "sortOrder" | "createdAt">>(list: T[]): T[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : 1));
}
