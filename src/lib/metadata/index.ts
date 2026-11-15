import "server-only";
import { looksLikeIsbn, toIsbn13 } from "@/lib/isbn";
import { titleAuthorKey } from "@/lib/duplicates";
import { googleBooks } from "./googleBooks";
import { hardcover } from "./hardcover";
import { mergeMetadata, mergeSearchResults } from "./merge";
import { openLibrary } from "./openLibrary";
import type { BookMetadata, MetadataProvider } from "./types";

export type { BookMetadata, CoverCandidate, ProviderName, PublicRating } from "./types";

const PROVIDERS: MetadataProvider[] = [hardcover, googleBooks, openLibrary];

function active(): MetadataProvider[] {
  return PROVIDERS.filter((p) => p.isConfigured());
}

/** Runs a provider call; a failure is logged and becomes an empty result, never an error. */
async function safely<T>(provider: MetadataProvider, what: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown error";
    console.warn(`[metadata] ${provider.name} ${what} failed: ${reason}`);
    return fallback;
  }
}

/** Looks the ISBN up in every configured provider and merges what comes back. */
export async function lookupByIsbn(isbn: string): Promise<BookMetadata | null> {
  const isbn13 = toIsbn13(isbn);
  if (!isbn13) return null;
  const results = await Promise.all(
    active().map((p) => safely(p, "lookup", () => p.lookupByIsbn(isbn13), null as BookMetadata | null)),
  );
  const found = results.filter((m): m is BookMetadata => m !== null);
  const merged = mergeMetadata(found);
  if (merged && !merged.isbn13) merged.isbn13 = isbn13;
  return merged;
}

/** Free-text search across providers (an ISBN-looking query is a lookup). Merged and deduplicated. */
export async function search(query: string): Promise<BookMetadata[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (looksLikeIsbn(q)) {
    const one = await lookupByIsbn(q);
    return one ? [one] : [];
  }
  const perProvider = await Promise.all(active().map((p) => safely(p, "search", () => p.search(q), [] as BookMetadata[])));
  return mergeSearchResults(perProvider);
}

/**
 * Fresh metadata for a stored book: by ISBN-13 when it has one, otherwise the best
 * title + author match from a search. Returns null when nothing matches.
 */
export async function refreshFor(book: { title: string; authors: string[]; isbn13: string | null }): Promise<BookMetadata | null> {
  if (book.isbn13) {
    const byIsbn = await lookupByIsbn(book.isbn13);
    if (byIsbn) return byIsbn;
  }
  const results = await search(`${book.title} ${book.authors[0] ?? ""}`.trim());
  const key = titleAuthorKey(book.title, book.authors);
  return results.find((r) => titleAuthorKey(r.title, r.authors) === key) ?? null;
}

export function configuredProviders(): string[] {
  return active().map((p) => p.name);
}
