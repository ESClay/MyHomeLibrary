/**
 * Series gap computation. Pure: given the library's books and the cached series (with entries), says which
 * volumes of each series the library does not have.
 *
 * Rules:
 *  - a series counts when at least one library book is linked to it (books.series_id);
 *  - an entry is "in the library" when it matches by Hardcover book id, ISBN-13 or normalized title + author;
 *  - entries with a future release date, compilations (omnibus, box set) and entries with no position are not
 *    volumes anyone can be missing, so they are left out; fractional positions (novellas, 2.5) are kept;
 *  - entries are in position order and series are ordered by how much of them the library already has.
 */
import { buildLibraryIndex, inLibrary, type LibraryBookLite } from "./match";

export type GapBook = LibraryBookLite & { seriesId: string | null };

export type GapEntry = {
  id: string;
  position: number | null;
  title: string;
  authors: string[];
  hardcoverBookId: number | null;
  isbn13: string | null;
  coverUrl: string | null;
  /** YYYY-MM-DD */
  releaseDate: string | null;
  isCompilation: boolean;
};

export type GapSeries = {
  id: string;
  name: string;
  hardcoverId: number | null;
  syncedAt: string | null;
  authorName?: string | null;
  entries: GapEntry[];
};

export type SeriesGap = {
  series: Omit<GapSeries, "entries">;
  /** Volumes the library has (eligible entries only). */
  owned: number;
  /** Volumes that exist and are out: the denominator of "3 of 7". */
  total: number;
  /** Eligible entries in position order, each marked in or out of the library. */
  volumes: { entry: GapEntry; have: boolean }[];
  missing: GapEntry[];
  /** True when nothing has been fetched for this series yet. */
  pending: boolean;
};

/** Whether an entry is a real, released, numbered volume. */
export function isVolume(e: GapEntry, today: string): boolean {
  if (e.position === null || e.isCompilation) return false;
  if (e.releaseDate && e.releaseDate > today) return false;
  return true;
}

const dayOf = (now: Date | number) => new Date(now).toISOString().slice(0, 10);

export function computeGaps(input: { books: GapBook[]; series: GapSeries[]; now?: Date | number }): SeriesGap[] {
  const today = dayOf(input.now ?? Date.now());
  const index = buildLibraryIndex(input.books);
  const linked = new Set(input.books.map((b) => b.seriesId).filter((s): s is string => !!s));

  const out: SeriesGap[] = [];
  for (const s of input.series) {
    if (!linked.has(s.id)) continue;
    const { entries, ...series } = s;
    const volumes = entries
      .filter((e) => isVolume(e, today))
      .sort((a, b) => (a.position as number) - (b.position as number) || a.title.localeCompare(b.title))
      .map((entry) => ({
        entry,
        have: inLibrary(index, {
          title: entry.title,
          authors: entry.authors,
          isbn13s: [entry.isbn13],
          hardcoverId: entry.hardcoverBookId,
        }),
      }));
    const missing = volumes.filter((v) => !v.have).map((v) => v.entry);
    out.push({
      series,
      owned: volumes.length - missing.length,
      total: volumes.length,
      volumes,
      missing,
      pending: s.syncedAt === null,
    });
  }
  out.sort((a, b) => b.owned - a.owned || a.series.name.localeCompare(b.series.name));
  return out;
}
