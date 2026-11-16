import "server-only";
import { looksLikeIsbn, toIsbn13 } from "@/lib/isbn";
import { titleAuthorKey } from "@/lib/duplicates";
import { googleBooks } from "./googleBooks";
import { hardcover } from "./hardcover";
import { mergeMetadata, mergeSearchResults } from "./merge";
import { openLibrary } from "./openLibrary";
import { providerSetKey, type ProviderPolicy } from "./policy";
import type { BookMetadata, MetadataProvider } from "./types";

export type { BookMetadata, CoverCandidate, ProviderName, PublicRating } from "./types";
export { ALL_PROVIDERS, OPEN_PROVIDERS, providersFor, type ProviderPolicy } from "./policy";

const PROVIDERS: MetadataProvider[] = [hardcover, googleBooks, openLibrary];

/** The configured providers the policy allows. A policy that names none allows none: callers must say what they may use. */
function active(policy: ProviderPolicy): MetadataProvider[] {
  const allowed = new Set(policy.providers);
  return PROVIDERS.filter((p) => allowed.has(p.name) && p.isConfigured());
}

// Merged results are cached briefly, keyed by the provider set as well as the request. A result merged from
// Hardcover can therefore never be served to a request that is only allowed Open Library (and the other way round).
const RESULT_TTL_MS = 5 * 60 * 1000;
const RESULT_MAX = 300;
const results = new Map<string, { expires: number; value: unknown }>();

/** The cache key of one merged lookup. Exported for tests. */
export function resultKey(op: "isbn" | "search", policy: ProviderPolicy, arg: string): string {
  return `${providerSetKey(policy)}|${op}|${arg}`;
}

async function cached<T>(key: string, run: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = results.get(key);
  if (hit && hit.expires > now) return structuredClone(hit.value) as T;
  const value = await run();
  if (results.size >= RESULT_MAX) {
    for (const [k, v] of results) if (v.expires <= now) results.delete(k);
    if (results.size >= RESULT_MAX) results.delete(results.keys().next().value as string);
  }
  results.set(key, { expires: now + RESULT_TTL_MS, value: structuredClone(value) });
  return value;
}

/** Clears the merged-result cache. Used by tests. */
export function clearMetadataCache() {
  results.clear();
}

let lastRateLimitedAt = 0;

/** True when any provider answered "too many requests" at or after `since` (epoch ms). Used by bulk imports to back off. */
export function rateLimitedSince(since: number): boolean {
  return lastRateLimitedAt >= since;
}

/** Runs a provider call; a failure is logged and becomes an empty result, never an error. */
async function safely<T>(provider: MetadataProvider, what: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown error";
    if (/\b429\b/.test(reason)) lastRateLimitedAt = Date.now();
    console.warn(`[metadata] ${provider.name} ${what} failed: ${reason}`);
    return fallback;
  }
}

/** Looks the ISBN up in every configured provider and merges what comes back. */
export async function lookupByIsbn(isbn: string, policy: ProviderPolicy): Promise<BookMetadata | null> {
  const isbn13 = toIsbn13(isbn);
  if (!isbn13) return null;
  const providers = active(policy);
  if (providers.length === 0) return null;
  return cached(resultKey("isbn", policy, isbn13), async () => {
    const found = (await Promise.all(providers.map((p) => safely(p, "lookup", () => p.lookupByIsbn(isbn13), null as BookMetadata | null)))).filter(
      (m): m is BookMetadata => m !== null,
    );
    const merged = mergeMetadata(found);
    if (merged && !merged.isbn13) merged.isbn13 = isbn13;
    return merged;
  });
}

/** Free-text search across providers (an ISBN-looking query is a lookup). Merged and deduplicated. */
export async function search(query: string, policy: ProviderPolicy): Promise<BookMetadata[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (looksLikeIsbn(q)) {
    const one = await lookupByIsbn(q, policy);
    return one ? [one] : [];
  }
  const providers = active(policy);
  if (providers.length === 0) return [];
  return cached(resultKey("search", policy, q.toLowerCase()), async () => {
    const perProvider = await Promise.all(providers.map((p) => safely(p, "search", () => p.search(q), [] as BookMetadata[])));
    return mergeSearchResults(perProvider);
  });
}

/**
 * Fresh metadata for a stored book: by ISBN-13 when it has one, otherwise the best
 * title + author match from a search. Returns null when nothing matches.
 */
export async function refreshFor(book: { title: string; authors: string[]; isbn13: string | null }, policy: ProviderPolicy): Promise<BookMetadata | null> {
  if (book.isbn13) {
    const byIsbn = await lookupByIsbn(book.isbn13, policy);
    if (byIsbn) return byIsbn;
  }
  const found = await search(`${book.title} ${book.authors[0] ?? ""}`.trim(), policy);
  const key = titleAuthorKey(book.title, book.authors);
  return found.find((r) => titleAuthorKey(r.title, r.authors) === key) ?? null;
}

export function configuredProviders(policy: ProviderPolicy): string[] {
  return active(policy).map((p) => p.name);
}
