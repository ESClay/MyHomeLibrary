import type { LibraryItem } from "@/lib/books/library-query";
import { primaryLoan } from "@/lib/loans/rules";
import { ROW_COVERS } from "./constants";
import { sortByPosition } from "./positions";
import type { CoverLite, ReadingGroup, Shelf, ShelfBookRef } from "./types";

export const toCover = (i: LibraryItem): CoverLite => ({
  id: i.id,
  title: i.title,
  author: i.authors[0] ?? null,
  coverUrl: i.coverUrl,
  loan: primaryLoan(i.loans),
});

/** A manual shelf's book ids in its own order: by stored position, then id. */
export function idsByPosition(refs: Pick<ShelfBookRef, "bookId" | "position">[]): string[] {
  return sortByPosition(refs.map((r) => ({ id: r.bookId, pos: r.position }))).map((r) => r.id);
}

/** A reading row: one person's "reading" status on one book. */
export type ReadingRow = { userId: string; bookId: string; createdAt: string };

/** Per person, their reading rows newest-added first. */
function groupReading(rows: ReadingRow[]): Map<string, ReadingRow[]> {
  const groups = new Map<string, ReadingRow[]>();
  for (const r of rows) {
    const list = groups.get(r.userId);
    if (list) list.push(r);
    else groups.set(r.userId, [r]);
  }
  for (const list of groups.values()) list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.bookId < b.bookId ? -1 : 1));
  return groups;
}

/** The book ids whose covers the reading groups show. Only these need their details loaded. */
export function readingCoverIds(rows: ReadingRow[]): string[] {
  return [...groupReading(rows).values()].flatMap((list) => list.slice(0, ROW_COVERS).map((r) => r.bookId));
}

/** Every member's books with status "reading", me first. Groups with no books are left out. `items` holds at least the cover books. */
export function buildReadingGroups(rows: ReadingRow[], items: Map<string, LibraryItem>, names: Map<string, string>, userId: string): ReadingGroup[] {
  const out: ReadingGroup[] = [];
  for (const [uid, list] of groupReading(rows)) {
    out.push({
      userId: uid,
      name: uid === userId ? (names.get(uid) ?? "You") : (names.get(uid) ?? "Member"),
      isMe: uid === userId,
      count: list.length,
      covers: list
        .slice(0, ROW_COVERS)
        .map((r) => items.get(r.bookId))
        .filter((i): i is LibraryItem => !!i)
        .map(toCover),
    });
  }
  return out.sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, "en"));
}

/** The order shelves are shown in: sort_order, then age, then id. */
export function sortShelves<T extends Pick<Shelf, "id" | "sortOrder" | "createdAt">>(list: T[]): T[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : 1));
}
