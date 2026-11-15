import "server-only";
import { fetchJson } from "./http";
import { description, emptyMetadata, httpsUrl, pickIsbns, posInt, rating, str, strArray, uniqueStrings } from "./util";
import type { BookMetadata, CoverCandidate, MetadataProvider } from "./types";

/* Google Books v1 (volumes). Works without a key (shared quota); GOOGLE_BOOKS_API_KEY raises it. */

const BASE = "https://www.googleapis.com/books/v1/volumes";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

function withKey(url: string): string {
  const key = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  return key ? `${url}&key=${encodeURIComponent(key)}` : url;
}

/** Google thumbnails are http, curled and tiny: use https, drop the curl edge, ask for zoom 2. */
function tidyCover(url: unknown): string | null {
  const u = httpsUrl(url);
  if (!u) return null;
  return u.replace("&edge=curl", "").replace(/zoom=\d/, "zoom=2");
}

/** Categories look like "Fiction / Fantasy / Epic": split into unique words of the hierarchy. */
function genresFrom(categories: unknown): string[] {
  const parts = strArray(categories).flatMap((c) => c.split("/").map((p) => p.trim()));
  return uniqueStrings(parts.filter(Boolean)).slice(0, 8);
}

/** Normalizes one `volumes` item. Exported for tests. */
export function normalizeGoogleVolume(item: unknown): BookMetadata | null {
  const it = obj(item);
  const info = obj(it?.volumeInfo);
  const title = str(info?.title);
  if (!it || !info || !title) return null;

  const m = emptyMetadata("google");
  const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
  const { isbn13, isbn10 } = pickIsbns(identifiers.map((i) => obj(i)?.identifier));
  const links = obj(info.imageLinks);
  const covers: CoverCandidate[] = [];
  for (const k of ["extraLarge", "large", "medium", "thumbnail", "small", "smallThumbnail"]) {
    const u = tidyCover(links?.[k]);
    if (u) covers.push({ url: u, source: "google" });
  }

  m.title = title;
  m.subtitle = str(info.subtitle);
  m.authors = strArray(info.authors);
  m.description = description(info.description);
  m.covers = covers.slice(0, 2);
  m.pageCount = posInt(info.pageCount);
  m.publishedDate = str(info.publishedDate);
  m.genres = genresFrom(info.categories);
  m.isbn13 = isbn13;
  m.isbn10 = isbn10;
  const id = str(it.id);
  if (id) m.ids.google = id;
  m.rating = rating(info.averageRating, info.ratingsCount, "google");
  return m;
}

export function normalizeGoogleResponse(body: unknown): BookMetadata[] {
  const items = obj(body)?.items;
  if (!Array.isArray(items)) return [];
  return items.map(normalizeGoogleVolume).filter((m): m is BookMetadata => m !== null);
}

export const googleBooks: MetadataProvider = {
  name: "google",
  isConfigured: () => true,

  async lookupByIsbn(isbn13) {
    const body = await fetchJson(withKey(`${BASE}?q=isbn:${isbn13}&maxResults=3&printType=books`), {
      cacheKey: "gb-isbn",
    });
    const all = normalizeGoogleResponse(body);
    return all.find((m) => m.isbn13 === isbn13) ?? all[0] ?? null;
  },

  async search(query) {
    const body = await fetchJson(
      withKey(`${BASE}?q=${encodeURIComponent(query)}&maxResults=10&printType=books`),
      { cacheKey: "gb-search" },
    );
    return normalizeGoogleResponse(body);
  },
};
