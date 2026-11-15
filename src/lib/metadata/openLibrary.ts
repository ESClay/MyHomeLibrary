import "server-only";
import { fetchJson } from "./http";
import { cover, emptyMetadata, pickIsbns, posInt, rating, str, strArray, uniqueStrings } from "./util";
import type { BookMetadata, MetadataProvider } from "./types";

/* Open Library: no key. Books API (jscmd=data) for ISBN lookup, search.json for search. */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

const SEARCH_FIELDS =
  "key,title,subtitle,author_name,first_publish_year,isbn,cover_i,number_of_pages_median,ratings_average,ratings_count,subject";

function names(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return uniqueStrings(list.map((x) => str(obj(x)?.name)).filter((s): s is string => s !== null));
}

/** Normalizes a Books API record (`api/books?jscmd=data`). Exported for tests. */
export function normalizeOpenLibraryBook(record: unknown): BookMetadata | null {
  const r = obj(record);
  const title = str(r?.title);
  if (!r || !title) return null;

  const m = emptyMetadata("openlibrary");
  const ids = obj(r.identifiers);
  const { isbn13, isbn10 } = pickIsbns([...strArray(ids?.isbn_13), ...strArray(ids?.isbn_10)]);
  const covers = obj(r.cover);

  m.title = title;
  m.subtitle = str(r.subtitle);
  m.authors = names(r.authors);
  m.covers = [...cover(covers?.large, "openlibrary"), ...cover(covers?.medium, "openlibrary")];
  m.pageCount = posInt(r.number_of_pages);
  m.publishedDate = str(r.publish_date);
  m.genres = names(r.subjects).slice(0, 8);
  m.isbn13 = isbn13;
  m.isbn10 = isbn10;
  const olid = strArray(ids?.openlibrary)[0];
  if (olid) m.ids.openLibrary = olid;
  return m;
}

/** Normalizes one `search.json` doc. Exported for tests. */
export function normalizeOpenLibraryDoc(doc: unknown): BookMetadata | null {
  const d = obj(doc);
  const title = str(d?.title);
  if (!d || !title) return null;

  const m = emptyMetadata("openlibrary");
  const { isbn13, isbn10 } = pickIsbns(Array.isArray(d.isbn) ? d.isbn : []);
  const coverId = posInt(d.cover_i);

  m.title = title;
  m.subtitle = str(d.subtitle);
  m.authors = strArray(d.author_name);
  m.covers = coverId ? cover(`https://covers.openlibrary.org/b/id/${coverId}-L.jpg`, "openlibrary") : [];
  m.pageCount = posInt(d.number_of_pages_median);
  const year = posInt(d.first_publish_year);
  m.publishedDate = year ? String(year) : null;
  m.genres = strArray(d.subject).slice(0, 8);
  m.isbn13 = isbn13;
  m.isbn10 = isbn10;
  const key = str(d.key);
  if (key) m.ids.openLibrary = key.replace(/^\/works\//, "");
  m.rating = rating(d.ratings_average, d.ratings_count, "openlibrary");
  return m;
}

export const openLibrary: MetadataProvider = {
  name: "openlibrary",
  isConfigured: () => true,

  async lookupByIsbn(isbn13) {
    const body = await fetchJson<Json>(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&jscmd=data&format=json`,
    );
    const record = body[`ISBN:${isbn13}`];
    const m = normalizeOpenLibraryBook(record);
    if (m && !m.isbn13) m.isbn13 = isbn13;
    return m;
  },

  async search(query) {
    const body = await fetchJson<Json>(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=${SEARCH_FIELDS}`,
    );
    const docs = Array.isArray(body.docs) ? body.docs : [];
    return docs.map(normalizeOpenLibraryDoc).filter((m): m is BookMetadata => m !== null);
  },
};
