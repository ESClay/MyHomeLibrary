import "server-only";
import { createPacer, type Pacer, type PacerState } from "@/lib/calibre/pacer";
import { normalizeTitle, authorSurname } from "@/lib/duplicates";
import { cleanTitle } from "@/lib/discover/match";
import { hardcover, hardcoverConfigured, hardcoverQuery } from "./hardcover";
import { num, pickIsbns, posInt, str, uniqueStrings } from "./util";

/*
 * Hardcover series queries. Verified against the live API on 2026-11-15 (fixtures in __fixtures__/hardcover-series-*.json)
 * and the docs source (github.com/hardcoverapp/hardcover-docs: Schemas/Series.mdx, BookSeries.mdx, Books.mdx and
 * guides/GettingBooksInSeries.mdx).
 *
 * Facts the code relies on:
 *  - `books.book_series[]` links a book to every series it is in. Exactly one is `featured`; `position` is a float8
 *    (novellas are 0.5, 1.5 ...), `details` is its text form ("1", or "0, 5" / "1-3" for a collection).
 *  - `book_series.compilation` marks a compilation. A book's own `books.compilation` ("Is a compilation or anthology")
 *    is a second flag: The Witcher's "La Dame du lac / La saison des orages" has book_series.compilation=false but
 *    books.compilation=true and details "0, 5". The code reads both and the `details` text.
 *  - Duplicates and merged books are filtered the way the docs guide says: canonical_id null, is_partial_book false,
 *    distinct_on position ordered by users_count.
 *  - Limits (Free plan): 60 requests/min, burst 10, 5000/day; every TOP-LEVEL field of a query costs one request.
 *    Each query below has exactly one top-level field.
 */

// ---------------------------------------------------------------- queries

/** Up to BOOK_BATCH books' series in one request (one top-level field). */
export const BOOK_SERIES_QUERY = `
query BooksSeries($ids: [Int!]!) {
  books(where: { id: { _in: $ids } }) {
    id
    title
    book_series(order_by: { featured: desc }) {
      position
      details
      compilation
      featured
      series { id name canonical_id state books_count primary_books_count }
    }
  }
}`;

export const BOOK_BATCH = 40;

/** One series with its de-duplicated, non-compilation books in position order. */
export const SERIES_BOOKS_QUERY = `
query SeriesBooks($id: Int!, $limit: Int!) {
  series(where: { id: { _eq: $id }, canonical_id: { _is_null: true } }, limit: 1) {
    id
    name
    books_count
    author { name }
    book_series(
      distinct_on: position
      order_by: [{ position: asc }, { book: { users_count: desc } }]
      where: { compilation: { _eq: false }, book: { canonical_id: { _is_null: true }, is_partial_book: { _eq: false } } }
      limit: $limit
    ) {
      position
      details
      compilation
      book {
        id
        title
        release_date
        release_year
        compilation
        cached_image
        contributions { contribution author { name } }
        default_physical_edition { isbn_13 }
        default_cover_edition { isbn_13 }
      }
    }
  }
}`;

/** A series is never longer than this many numbered entries in practice; it also bounds the response. */
export const SERIES_ENTRY_LIMIT = 150;

export const SERIES_SEARCH_QUERY = `
query SearchSeries($q: String!, $n: Int!) {
  search(query: $q, query_type: "Series", per_page: $n, page: 1) { results }
}`;

// ---------------------------------------------------------------- types

export type BookSeriesRef = {
  seriesId: number;
  name: string;
  featured: boolean;
  position: number | null;
  compilation: boolean;
  /** series.canonical_id is set when the series was merged into another; such links are ignored. */
};

export type BookSeriesLinks = { bookId: number; title: string | null; series: BookSeriesRef[] };

export type SeriesEntryData = {
  position: number;
  /** Text form of the position ("1", "0, 5", "1-3"). */
  details: string | null;
  hardcoverBookId: number;
  title: string;
  authors: string[];
  /** YYYY-MM-DD, or null when unknown. */
  releaseDate: string | null;
  isbn13: string | null;
  coverUrl: string | null;
  isCompilation: boolean;
};

export type SeriesData = {
  hardcoverId: number;
  name: string;
  authorName: string | null;
  booksCount: number | null;
  entries: SeriesEntryData[];
  /** Entries the normalizer dropped (no position or no title). */
  skipped: number;
};

export type SeriesSearchHit = {
  hardcoverId: number;
  name: string;
  authorName: string | null;
  booksCount: number;
  primaryBooksCount: number;
  readersCount: number;
};

// ---------------------------------------------------------------- normalizers

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

/** Normalizes `data.books` from BOOK_SERIES_QUERY. Merged (canonical) series are skipped. */
export function normalizeBookSeries(books: unknown): BookSeriesLinks[] {
  if (!Array.isArray(books)) return [];
  const out: BookSeriesLinks[] = [];
  for (const b of books) {
    const book = obj(b);
    const bookId = posInt(book?.id);
    if (!book || !bookId) continue;
    const refs: BookSeriesRef[] = [];
    for (const link of Array.isArray(book.book_series) ? book.book_series : []) {
      const l = obj(link);
      const s = obj(l?.series);
      const seriesId = posInt(s?.id);
      const name = str(s?.name);
      if (!l || !s || !seriesId || !name) continue;
      if (s.canonical_id !== null && s.canonical_id !== undefined) continue;
      if (str(s.state) && str(s.state) !== "active") continue;
      refs.push({
        seriesId,
        name,
        featured: l.featured === true,
        position: num(l.position),
        compilation: l.compilation === true,
      });
    }
    out.push({ bookId, title: str(book.title), series: refs });
  }
  return out;
}

const OMNIBUS_TITLE = /\b(box(ed)?\s*set|omnibus|collector'?s? edition|complete (series|collection|saga|trilogy)|the (complete|collected)|books?\s+\d+\s*(-|–|to|&)\s*\d+|\d+-book|trilogy|boxset)\b/i;

/**
 * Whether a series entry is a compilation. Hardcover has two flags (`book_series.compilation` and `books.compilation`),
 * which disagree for some entries, plus the `details` text ("0, 5", "1-3") for ranges. When none of them is set, a
 * title heuristic catches the rest: "box set", "omnibus", "complete series/collection/saga/trilogy", "books 1-3", "N-book".
 */
export function isCompilationEntry(e: { bookSeriesCompilation: boolean; bookCompilation: boolean; details: string | null; title: string }): boolean {
  if (e.bookSeriesCompilation || e.bookCompilation) return true;
  const details = e.details?.trim();
  if (details && !/^\d+(\.\d+)?$/.test(details)) return true;
  return OMNIBUS_TITLE.test(e.title);
}

function authorsOf(contributions: unknown): string[] {
  if (!Array.isArray(contributions)) return [];
  const names: string[] = [];
  for (const c of contributions) {
    const role = str(obj(c)?.contribution);
    if (role && role.toLowerCase() !== "author") continue;
    const name = str(obj(obj(c)?.author)?.name);
    if (name) names.push(name);
  }
  return uniqueStrings(names);
}

/** A Postgres-ready date from a Hardcover date. Accepts YYYY-MM-DD; a bare year becomes null (too vague to compare with today). */
function isoDate(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** Normalizes `data.series[0]` from SERIES_BOOKS_QUERY. Entries without a numeric position or a title are skipped. */
export function normalizeSeriesBooks(series: unknown): SeriesData | null {
  const s = obj(series);
  const hardcoverId = posInt(s?.id);
  const name = str(s?.name);
  if (!s || !hardcoverId || !name) return null;

  const entries: SeriesEntryData[] = [];
  let skipped = 0;
  for (const row of Array.isArray(s.book_series) ? s.book_series : []) {
    const r = obj(row);
    const book = obj(r?.book);
    const position = num(r?.position);
    const title = str(book?.title);
    const bookId = posInt(book?.id);
    if (!r || !book || position === null || !title || !bookId) {
      skipped++;
      continue;
    }
    const details = str(r.details);
    const { isbn13 } = pickIsbns([obj(book.default_physical_edition)?.isbn_13, obj(book.default_cover_edition)?.isbn_13]);
    entries.push({
      position,
      details,
      hardcoverBookId: bookId,
      title,
      authors: authorsOf(book.contributions),
      releaseDate: isoDate(book.release_date),
      isbn13,
      coverUrl: str(obj(book.cached_image)?.url),
      isCompilation: isCompilationEntry({
        bookSeriesCompilation: r.compilation === true,
        bookCompilation: book.compilation === true,
        details,
        title,
      }),
    });
  }
  entries.sort((a, b) => a.position - b.position);
  return {
    hardcoverId,
    name,
    authorName: str(obj(s.author)?.name),
    booksCount: posInt(s.books_count),
    entries,
    skipped,
  };
}

/** Normalizes `data.search.results` of a "Series" search. */
export function normalizeSeriesSearch(results: unknown): SeriesSearchHit[] {
  const hits = obj(results)?.hits;
  if (!Array.isArray(hits)) return [];
  const out: SeriesSearchHit[] = [];
  for (const h of hits) {
    const d = obj(obj(h)?.document) ?? obj(h);
    const hardcoverId = posInt(d?.id);
    const name = str(d?.name);
    if (!d || !hardcoverId || !name) continue;
    out.push({
      hardcoverId,
      name,
      authorName: str(d.author_name) ?? str(obj(d.author)?.name),
      booksCount: posInt(d.books_count) ?? 0,
      primaryBooksCount: posInt(d.primary_books_count) ?? 0,
      readersCount: posInt(d.readers_count) ?? 0,
    });
  }
  return out;
}

const seriesWords = (s: string) => normalizeTitle(s.replace(/\b(series|saga|trilogy|chronicles?)\b/gi, ""));

/**
 * The search hit for a named series by a given author: the name must match (ignoring "series"/"saga" and case) and, when an
 * author is known, so must the author's surname. The most-read candidate wins. Null when nothing fits.
 */
export function pickSeriesHit(hits: SeriesSearchHit[], want: { name: string; author: string | null }): SeriesSearchHit | null {
  const name = seriesWords(want.name);
  const surname = authorSurname(want.author ?? undefined);
  const fits = hits.filter((h) => {
    if (seriesWords(h.name) !== name) return false;
    if (!surname) return true;
    return authorSurname(h.authorName ?? undefined) === surname;
  });
  fits.sort((a, b) => b.readersCount - a.readersCount || b.booksCount - a.booksCount);
  return fits[0] ?? null;
}

/** Which of a book's series to file it under: the one named like its own series text, else the featured one. */
export function chooseSeriesRef(refs: BookSeriesRef[], seriesName: string | null): BookSeriesRef | null {
  const usable = refs.filter((r) => !r.compilation);
  if (usable.length === 0) return null;
  if (seriesName) {
    const wanted = seriesWords(seriesName);
    const named = usable.find((r) => seriesWords(r.name) === wanted);
    if (named) return named;
  }
  return usable.find((r) => r.featured) ?? null;
}

// ---------------------------------------------------------------- finding a book on Hardcover

/** A Hardcover book found by ISBN or search. */
export type BookCandidate = { hardcoverId: number; title: string; authors: string[] };

const titleKey = (t: string) => normalizeTitle(cleanTitle(t));

const words = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);

/** Surname and first initial of "First Last" or "Last, First"; the initial is "" when there is no given name. */
function nameKey(author: string): { surname: string; initial: string } {
  const comma = author.indexOf(",");
  const w = comma > 0 ? [...words(author.slice(comma + 1)), ...words(author.slice(0, comma))] : words(author);
  return { surname: w[w.length - 1] ?? "", initial: w.length > 1 ? w[0][0] : "" };
}

/** Same person by surname, and by first initial when both names give one ("Frank Herbert" is not "Brian Herbert"). */
function sameAuthor(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  return x.surname !== "" && x.surname === y.surname && (x.initial === "" || y.initial === "" || x.initial === y.initial);
}

/**
 * The search result that is confidently the book asked for, else null (never a guess). Needs the same title (case,
 * accents, punctuation, a leading article and a trailing "(Series, #1)" ignored; a subtitle after a colon on either side
 * is allowed) AND the same first author (surname, and first initial when both give one) among the candidate's authors. A book with no author on file cannot be
 * matched by title alone, so it is skipped. The first (best ranked) fitting result wins.
 */
export function pickBookMatch(cands: BookCandidate[], want: { title: string; author: string | null }): BookCandidate | null {
  const author = want.author?.trim() ?? "";
  const title = titleKey(want.title);
  if (!nameKey(author).surname || !title) return null;
  const head = (t: string) => titleKey(t.split(":")[0] ?? t);
  return (
    cands.find((c) => {
      const ct = titleKey(c.title);
      const titleOk = ct === title || head(c.title) === title || ct === head(want.title);
      return titleOk && c.authors.some((a) => sameAuthor(a, author));
    }) ?? null
  );
}

// ---------------------------------------------------------------- requests (paced)

/** Spacing between requests, so a sync stays near 54/min, under the 60/min limit and well under the burst of 10. */
export const REQUEST_GAP_MS = 1100;
const sharedPace: PacerState = { last: 0 };

export function seriesPacer(budgetMs: number): Pacer {
  return createPacer({ gapMs: REQUEST_GAP_MS, budgetMs, state: sharedPace });
}

export type SeriesApi = {
  configured(): boolean;
  /** Series of up to BOOK_BATCH books (their Hardcover ids), one request. */
  bookSeries(ids: number[]): Promise<BookSeriesLinks[]>;
  /** One series' books, one request. Null when the series no longer exists (merged or removed). */
  seriesBooks(id: number): Promise<SeriesData | null>;
  /** Series search (one request). */
  searchSeries(query: string): Promise<SeriesSearchHit[]>;
  /** The Hardcover book with this ISBN-13 (one request), or null. */
  bookByIsbn(isbn13: string): Promise<BookCandidate | null>;
  /** Book search by free text (one request), best match first. */
  searchBooks(query: string): Promise<BookCandidate[]>;
};

function candidate(m: { title: string | null; authors: string[]; ids: { hardcover?: number } } | null): BookCandidate | null {
  return m?.title && m.ids.hardcover ? { hardcoverId: m.ids.hardcover, title: m.title, authors: m.authors } : null;
}

const SERIES_TTL_MS = 30 * 60 * 1000;

/** The real Hardcover-backed implementation. The caller paces requests (see seriesPacer). */
export const hardcoverSeriesApi: SeriesApi = {
  configured: hardcoverConfigured,

  async bookSeries(ids) {
    if (ids.length === 0) return [];
    const data = await hardcoverQuery(BOOK_SERIES_QUERY, { ids: ids.slice(0, BOOK_BATCH) }, { timeoutMs: 20000, ttlMs: SERIES_TTL_MS });
    return normalizeBookSeries(data?.books);
  },

  async seriesBooks(id) {
    const data = await hardcoverQuery(SERIES_BOOKS_QUERY, { id, limit: SERIES_ENTRY_LIMIT }, { timeoutMs: 25000, ttlMs: SERIES_TTL_MS });
    const list = data?.series;
    return Array.isArray(list) && list.length > 0 ? normalizeSeriesBooks(list[0]) : null;
  },

  async searchSeries(query) {
    const data = await hardcoverQuery(SERIES_SEARCH_QUERY, { q: query, n: 8 }, { timeoutMs: 15000, ttlMs: SERIES_TTL_MS });
    return normalizeSeriesSearch(obj(data?.search)?.results);
  },

  async bookByIsbn(isbn13) {
    return candidate(await hardcover.lookupByIsbn(isbn13));
  },

  async searchBooks(query) {
    return (await hardcover.search(query)).map(candidate).filter((c): c is BookCandidate => c !== null);
  },
};
