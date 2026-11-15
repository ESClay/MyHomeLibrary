import { toIsbn13 } from "@/lib/isbn";
import { titleAuthorKey } from "@/lib/duplicates";
import { stripHtml } from "./html";
import { uniqueStrings } from "./util";
import type { BookMetadata, CoverCandidate, ProviderName } from "./types";

export const PROVIDER_PRIORITY: ProviderName[] = ["hardcover", "google", "openlibrary"];

function byPriority(list: BookMetadata[]): BookMetadata[] {
  const rank = (m: BookMetadata) => PROVIDER_PRIORITY.indexOf(m.providers[0]);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/** Same picture, different size or query string: reduce a cover URL to a comparison key. */
export function coverKey(url: string): string {
  try {
    const u = new URL(url);
    const id = u.searchParams.get("id");
    const base = `${u.hostname.replace(/^www\./, "")}${u.pathname}`
      .replace(/-(S|M|L)\.jpg$/i, "")
      .replace(/_(SX|SY|SL)\d+_?/i, "");
    return id ? `${base}?id=${id}` : base;
  } catch {
    return url;
  }
}

export function unionCovers(lists: CoverCandidate[][]): CoverCandidate[] {
  const seen = new Set<string>();
  const out: CoverCandidate[] = [];
  for (const c of lists.flat()) {
    const k = coverKey(c.url);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/**
 * Merges records for the same book. Rules:
 * - Hardcover wins for series and public rating; other providers fill gaps.
 * - Scalar fields (title, description, pages, date) come from the first provider that has them.
 * - Cover candidates are unioned and deduplicated; genres are unioned.
 * - ISBN-10 is converted to ISBN-13 when no ISBN-13 is known.
 * - Descriptions are stripped to plain text.
 * Returns null for an empty list.
 */
export function mergeMetadata(records: BookMetadata[]): BookMetadata | null {
  const list = byPriority(records);
  if (list.length === 0) return null;

  const first = <T,>(pick: (m: BookMetadata) => T | null | undefined): T | null => {
    for (const m of list) {
      const v = pick(m);
      if (v !== null && v !== undefined && !(typeof v === "string" && v === "")) return v;
    }
    return null;
  };

  const isbn10 = first((m) => m.isbn10);
  const isbn13 = first((m) => toIsbn13(m.isbn13)) ?? (isbn10 ? toIsbn13(isbn10) : null);
  const withSeries = list.find((m) => m.seriesName);
  const authors = first((m) => (m.authors.length > 0 ? m.authors : null)) ?? [];

  return {
    title: first((m) => m.title) ?? "",
    subtitle: first((m) => m.subtitle),
    authors,
    seriesName: withSeries?.seriesName ?? null,
    seriesPosition: withSeries?.seriesPosition ?? null,
    description: first((m) => stripHtml(m.description)),
    covers: unionCovers(list.map((m) => m.covers)),
    pageCount: first((m) => m.pageCount),
    publishedDate: first((m) => m.publishedDate),
    genres: uniqueStrings(list.flatMap((m) => m.genres)).slice(0, 8),
    isbn13,
    isbn10,
    ids: Object.assign({}, ...[...list].reverse().map((m) => m.ids)),
    rating: first((m) => m.rating),
    providers: uniqueStrings(list.flatMap((m) => m.providers)) as ProviderName[],
  };
}

/** Dedupe key for search results: ISBN-13 when known, else normalized title + author surname. */
export function resultKey(m: BookMetadata): string {
  return m.isbn13 ? `isbn:${m.isbn13}` : `ta:${titleAuthorKey(m.title, m.authors)}`;
}

/**
 * Combines per-provider search results into one list. Records describing the same book
 * (same ISBN-13 or same title + first author) are merged; order follows provider priority
 * and then each provider's own ranking.
 */
export function mergeSearchResults(perProvider: BookMetadata[][], limit = 20): BookMetadata[] {
  const groups = new Map<string, BookMetadata[]>();
  // Index title-author keys too, so a record with an ISBN joins a title-only record.
  const alias = new Map<string, string>();

  for (const results of perProvider) {
    for (const m of results) {
      const ta = `ta:${titleAuthorKey(m.title, m.authors)}`;
      const k = resultKey(m);
      const groupKey = alias.get(k) ?? alias.get(ta) ?? k;
      const g = groups.get(groupKey) ?? [];
      g.push(m);
      groups.set(groupKey, g);
      alias.set(k, groupKey);
      alias.set(ta, groupKey);
    }
  }

  const merged: BookMetadata[] = [];
  for (const g of groups.values()) {
    const m = mergeMetadata(g);
    if (m && m.title) merged.push(m);
  }
  return merged.slice(0, limit);
}
