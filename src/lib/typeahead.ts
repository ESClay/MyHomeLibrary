/** Typeahead for the Add search: query gating, a session cache and library-then-online merging. Pure, client-safe. */
import { normalizeTitle, titleAuthorKey } from "@/lib/duplicates";
import { cleanIsbn } from "@/lib/isbn";
import type { BookMetadata } from "@/lib/metadata/types";

/** Suggestions start at this many characters. */
export const MIN_CHARS = 3;
/** Pause in typing before the cheap library query fires. */
export const LIBRARY_DEBOUNCE_MS = 150;
/** Pause in typing before the online query fires (protects the Hardcover rate limit). */
export const ONLINE_DEBOUNCE_MS = 300;
export const LIBRARY_LIMIT = 5;
export const ONLINE_LIMIT = 8;
export const CACHE_MAX_ENTRIES = 50;
export const MAX_QUERY_LENGTH = 100;

/** Trim, collapse whitespace and lowercase. Cache keys and request queries use this form. */
export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
}

/** True when the (normalized) query is long enough to suggest for. */
export function shouldSuggest(raw: string): boolean {
  return normalizeQuery(raw).length >= MIN_CHARS;
}

/** Escapes `%`, `_` and `\` so user text is matched literally inside an ILIKE pattern. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** ILIKE patterns for the library lookup: one per word, all of which must match `search_text`. */
export function likePatterns(raw: string): string[] {
  return normalizeQuery(raw)
    .split(" ")
    .filter(Boolean)
    .map((t) => `%${escapeLike(t.replace(/[,()"]/g, " ").trim())}%`);
}

/** A bounded least-recently-used map, kept for the session. */
export class SuggestionCache<V> {
  private map = new Map<string, V>();
  constructor(private max = CACHE_MAX_ENTRIES) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  get size(): number {
    return this.map.size;
  }
}

export type LibrarySuggestion = {
  id: string;
  title: string;
  authors: string[];
  seriesName: string | null;
  seriesPosition: number | null;
  coverUrl: string | null;
  isbn13: string | null;
};

export type Suggestion =
  | { kind: "library"; key: string; book: LibrarySuggestion }
  | { kind: "online"; key: string; book: BookMetadata };

/**
 * Library books first, then online matches that are not already in the library
 * (same ISBN-13, or same normalized title + first-author surname). Online order is kept.
 */
export function mergeSuggestions(
  library: LibrarySuggestion[],
  online: BookMetadata[],
  limits: { library?: number; online?: number } = {},
): Suggestion[] {
  const lib = library.slice(0, limits.library ?? LIBRARY_LIMIT);
  const isbns = new Set(lib.map((b) => cleanIsbn(b.isbn13)).filter(Boolean));
  const keys = new Set(lib.map((b) => titleAuthorKey(b.title, b.authors)).filter((k) => !k.startsWith("|")));

  const out: Suggestion[] = lib.map((book) => ({ kind: "library", key: `lib:${book.id}`, book }));
  const seen = new Set<string>();
  let onlineCount = 0;
  for (const m of online) {
    if (onlineCount >= (limits.online ?? ONLINE_LIMIT)) break;
    const isbn = cleanIsbn(m.isbn13);
    const key = titleAuthorKey(m.title, m.authors);
    if (isbn && isbns.has(isbn)) continue;
    if (normalizeTitle(m.title) && keys.has(key)) continue;
    const id = `on:${isbn || key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ kind: "online", key: id, book: m });
    onlineCount++;
  }
  return out;
}

/** Text for the polite live region. */
export function announce(libraryCount: number, onlineCount: number, loading: boolean): string {
  if (libraryCount + onlineCount === 0) return loading ? "Searching." : "No matches.";
  const parts: string[] = [];
  if (libraryCount) parts.push(`${libraryCount} in your library`);
  if (onlineCount) parts.push(`${onlineCount} online`);
  return `${parts.join(", ")}.${loading ? " More loading." : ""}`;
}
