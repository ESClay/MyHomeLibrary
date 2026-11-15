import "server-only";
import { fetchJson } from "./http";
import { cover, description, emptyMetadata, num, pickIsbns, posInt, rating, str, strArray, uniqueStrings } from "./util";
import type { BookMetadata, MetadataProvider } from "./types";

/*
 * Hardcover GraphQL adapter. Field names come from the public docs source
 * (github.com/hardcoverapp/hardcover-docs: Searching, GettingBookDetails and the
 * books / editions / book_series / images schemas). It could NOT be run against the
 * live API in development because no token was available, so the normalizers read
 * defensively and the shape of `search().results` (Typesense hits) is unverified.
 */

const ENDPOINT = "https://api.hardcover.app/v1/graphql";

const BOOK_FIELDS = `
  id
  title
  subtitle
  description
  pages
  release_date
  rating
  ratings_count
  cached_image
  cached_tags
  contributions { contribution author { name } }
  featured_book_series { position series { id name } }
`;

const ISBN_QUERY = `
query ByIsbn($isbn: String!) {
  editions(
    where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] }
    order_by: { users_count: desc_nulls_last }
    limit: 1
  ) {
    id
    title
    isbn_10
    isbn_13
    pages
    release_date
    cached_image
    book { ${BOOK_FIELDS} }
  }
}`;

const SEARCH_QUERY = `
query Search($q: String!, $n: Int!) {
  search(query: $q, query_type: "Book", per_page: $n, page: 1) { results }
}`;

function token(): string | null {
  const t = process.env.HARDCOVER_API_TOKEN?.trim();
  return t ? t : null;
}

function authHeader(t: string): string {
  return /^bearer /i.test(t) ? t : `Bearer ${t}`;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

function imageUrl(v: unknown): string | null {
  return str(obj(v)?.url);
}

/** Genre names from `cached_tags`, shaped as { Genre: [{ tag: "Fantasy" }], Mood: [...] }. */
function genresFromTags(tags: unknown): string[] {
  const list = obj(tags)?.Genre;
  if (!Array.isArray(list)) return [];
  return uniqueStrings(list.map((t) => str(obj(t)?.tag)).filter((s): s is string => s !== null)).slice(0, 8);
}

function authorsFromContributions(contributions: unknown): string[] {
  if (!Array.isArray(contributions)) return [];
  const names: string[] = [];
  for (const c of contributions) {
    const role = str(obj(c)?.contribution);
    // A null contribution is a plain author on Hardcover; skip illustrators, translators and so on.
    if (role && role.toLowerCase() !== "author") continue;
    const name = str(obj(obj(c)?.author)?.name);
    if (name) names.push(name);
  }
  return uniqueStrings(names);
}

/** Normalizes one `editions` row (from the ISBN query). Exported for tests. */
export function normalizeHardcoverEdition(edition: unknown): BookMetadata | null {
  const ed = obj(edition);
  const book = obj(ed?.book);
  if (!ed || !book) return null;
  const title = str(book.title);
  if (!title) return null;

  const m = emptyMetadata("hardcover");
  const { isbn13, isbn10 } = pickIsbns([ed.isbn_13, ed.isbn_10]);
  const featured = obj(book.featured_book_series);
  const seriesName = str(obj(featured?.series)?.name);

  m.title = title;
  m.subtitle = str(book.subtitle);
  m.authors = authorsFromContributions(book.contributions);
  m.seriesName = seriesName;
  m.seriesPosition = seriesName ? num(featured?.position) : null;
  m.description = description(book.description);
  m.covers = [...cover(imageUrl(ed.cached_image), "hardcover"), ...cover(imageUrl(book.cached_image), "hardcover")];
  m.pageCount = posInt(ed.pages) ?? posInt(book.pages);
  m.publishedDate = str(ed.release_date) ?? str(book.release_date);
  m.genres = genresFromTags(book.cached_tags);
  m.isbn13 = isbn13;
  m.isbn10 = isbn10;
  const id = posInt(book.id);
  if (id) m.ids.hardcover = id;
  m.rating = rating(book.rating, book.ratings_count, "hardcover");
  return m;
}

/** Normalizes one Typesense search document from the `search` query. Exported for tests. */
export function normalizeHardcoverDocument(document: unknown): BookMetadata | null {
  const d = obj(document);
  const title = str(d?.title);
  if (!d || !title) return null;

  const m = emptyMetadata("hardcover");
  const { isbn13, isbn10 } = pickIsbns(Array.isArray(d.isbns) ? d.isbns : []);
  const featured = obj(d.featured_series);
  const seriesName =
    str(featured?.series_name) ??
    str(obj(featured?.series)?.name) ??
    str(featured?.name) ??
    strArray(d.series_names)[0] ??
    null;

  m.title = title;
  m.subtitle = str(d.subtitle);
  m.authors = strArray(d.author_names);
  m.seriesName = seriesName;
  m.seriesPosition = seriesName ? (num(d.featured_series_position) ?? num(featured?.position)) : null;
  m.description = description(d.description);
  m.covers = cover(imageUrl(d.image), "hardcover");
  m.pageCount = posInt(d.pages);
  const year = posInt(d.release_year);
  m.publishedDate = str(d.release_date) ?? (year ? String(year) : null);
  m.genres = strArray(d.genres).slice(0, 8);
  m.isbn13 = isbn13;
  m.isbn10 = isbn10;
  const id = posInt(d.id);
  if (id) m.ids.hardcover = id;
  m.rating = rating(d.rating, d.ratings_count, "hardcover");
  return m;
}

/** Pulls the hit documents out of the `search.results` JSON blob. */
export function hardcoverHits(results: unknown): unknown[] {
  const r = obj(results);
  const hits = r?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.map((h) => obj(h)?.document ?? h);
}

async function gql(query: string, variables: Json): Promise<Json | null> {
  const t = token();
  if (!t) return null;
  const res = await fetchJson<{ data?: Json; errors?: unknown }>(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader(t) },
    body: JSON.stringify({ query, variables }),
    timeoutMs: 8000,
    ttlMs: 10 * 60 * 1000,
  });
  if (res.errors && !res.data) throw new Error("Hardcover returned GraphQL errors");
  return res.data ?? null;
}

export const hardcover: MetadataProvider = {
  name: "hardcover",
  isConfigured: () => token() !== null,

  async lookupByIsbn(isbn13) {
    const data = await gql(ISBN_QUERY, { isbn: isbn13 });
    const editions = data?.editions;
    return Array.isArray(editions) && editions.length > 0 ? normalizeHardcoverEdition(editions[0]) : null;
  },

  async search(query) {
    const data = await gql(SEARCH_QUERY, { q: query, n: 10 });
    const results = obj(data?.search)?.results;
    return hardcoverHits(results)
      .map(normalizeHardcoverDocument)
      .filter((m): m is BookMetadata => m !== null);
  },
};
