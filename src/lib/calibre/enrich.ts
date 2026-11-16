/**
 * Filling the gaps Calibre leaves from the metadata providers. Pure apart from the injected lookups.
 * Calibre's values always win: a provider only supplies what the row left empty.
 */
import { normalizeTitle } from "@/lib/duplicates";
import type { BookMetadata } from "@/lib/metadata/types";
import {
  ISBN_AGREE_THRESHOLD,
  MATCH_THRESHOLD,
  rankCandidates,
  scoreCandidate,
  type Lookups,
} from "@/lib/scan/resolve";

/** What Calibre gave for a book. */
export type CalibreBook = {
  title: string;
  authors: string[];
  series: string | null;
  seriesPosition: number | null;
  isbn13: string | null;
};

/** Columns a provider may fill. Only keys that were empty are present. */
export type GapFields = Partial<{
  series_name: string;
  series_position: number | null;
  cover_url: string;
  page_count: number;
  genres: string[];
  public_rating: number;
  public_rating_count: number | null;
  rating_source: string;
  hardcover_id: number;
  google_books_id: string;
  ol_key: string;
}>;

export function gapFill(base: CalibreBook, meta: BookMetadata | null): GapFields {
  if (!meta) return {};
  const out: GapFields = {};

  if (!base.series) {
    if (meta.seriesName) {
      out.series_name = meta.seriesName;
      out.series_position = meta.seriesPosition;
    }
  } else if (
    base.seriesPosition === null &&
    meta.seriesName &&
    meta.seriesPosition !== null &&
    normalizeTitle(meta.seriesName) === normalizeTitle(base.series)
  ) {
    // Same series, only the number was missing. The name stays Calibre's.
    out.series_position = meta.seriesPosition;
  }

  const cover = meta.covers.find((c) => c.url.startsWith("https://"))?.url;
  if (cover) out.cover_url = cover;
  if (meta.pageCount && meta.pageCount > 0) out.page_count = meta.pageCount;
  if (meta.genres.length > 0) out.genres = meta.genres.slice(0, 8);
  if (meta.rating) {
    out.public_rating = meta.rating.value;
    out.public_rating_count = meta.rating.count;
    out.rating_source = meta.rating.source;
  }
  if (meta.ids.hardcover) out.hardcover_id = meta.ids.hardcover;
  if (meta.ids.google) out.google_books_id = meta.ids.google;
  if (meta.ids.openLibrary) out.ol_key = meta.ids.openLibrary;
  return out;
}

export type FindResult =
  | { kind: "found"; meta: BookMetadata; via: "isbn" | "search" }
  | { kind: "none" }
  /** No lookup slot was left in this batch's budget. */
  | { kind: "skipped" }
  | { kind: "rate-limited" };

/**
 * Looks a book up by ISBN, else by title + first author. A hit must roughly agree with what Calibre has, so a wrong ISBN
 * or a loose search result never decorates the book with another book's cover.
 * `take` hands out paced slots; `limited` says whether a provider has just answered "too many requests".
 */
export async function findMetadata(
  book: CalibreBook,
  lookups: Lookups,
  take: () => Promise<boolean>,
  limited: () => boolean,
): Promise<FindResult> {
  const probe = { title: book.title, authors: book.authors };
  let spent = false;

  if (book.isbn13) {
    if (!(await take())) return { kind: "skipped" };
    spent = true;
    const byIsbn = await lookups.lookupByIsbn(book.isbn13).catch(() => null);
    if (limited()) return { kind: "rate-limited" };
    if (byIsbn && scoreCandidate(probe, byIsbn) >= ISBN_AGREE_THRESHOLD) return { kind: "found", meta: byIsbn, via: "isbn" };
  }

  if (!(await take())) return spent ? { kind: "none" } : { kind: "skipped" };
  const results = await lookups.search(`${book.title} ${book.authors[0] ?? ""}`.trim()).catch(() => [] as BookMetadata[]);
  if (limited()) return { kind: "rate-limited" };
  const best = rankCandidates(probe, results)[0];
  if (best && best.score >= MATCH_THRESHOLD) return { kind: "found", meta: best.c, via: "search" };
  return { kind: "none" };
}
