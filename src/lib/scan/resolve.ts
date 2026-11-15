/**
 * Turns what the model read off a photo into catalogue matches: the best candidate plus a few alternates.
 * Pure apart from the injected lookups, so it is tested with mocked metadata.
 */
import type { DetectedBook } from "@/lib/ai/identify-schema";
import { authorSurname, normalizeTitle } from "@/lib/duplicates";
import type { BookMetadata } from "@/lib/metadata/types";
import { createLimiter } from "@/lib/scan/limiter";
import type { TrayDuplicate } from "@/lib/scan/tray";

export type Lookups = {
  lookupByIsbn: (isbn13: string) => Promise<BookMetadata | null>;
  search: (query: string) => Promise<BookMetadata[]>;
};

/** A search hit scoring below this is not offered as the match; the row starts unmatched. */
export const MATCH_THRESHOLD = 0.5;
/** An ISBN hit must at least roughly agree with the title that was read, or the digits were misread. */
export const ISBN_AGREE_THRESHOLD = 0.3;
/** Below this a candidate is not worth listing as an alternate. */
export const ALTERNATE_THRESHOLD = 0.25;
export const MAX_ALTERNATES = 3;

const words = (title: string) => new Set(normalizeTitle(title).split(" ").filter(Boolean));

/** 0 to 1: how well a catalogue record fits what was read. Title carries most of the weight, then the author surname. */
export function scoreCandidate(d: Pick<DetectedBook, "title" | "authors">, c: BookMetadata): number {
  const a = words(d.title);
  const b = words(c.title);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const jaccard = shared / (a.size + b.size - shared);
  // A spine often shows only the main title, while the record carries a subtitle.
  // One-word titles ("It", "Dune") are in far too many records to count for much on their own.
  const contained = shared === a.size ? 0.9 * Math.min(1, a.size / 2) : 0;
  const title = Math.max(jaccard, contained);

  const wanted = authorSurname(d.authors[0]);
  let author: number;
  if (!wanted) author = 0.5; // nothing printed to compare, so neither reward nor punish
  else author = c.authors.some((x) => authorSurname(x) === wanted) ? 1 : 0;
  return title * 0.7 + author * 0.3;
}

const sameBook = (x: BookMetadata, y: BookMetadata) =>
  (!!x.isbn13 && x.isbn13 === y.isbn13) ||
  (normalizeTitle(x.title) === normalizeTitle(y.title) && authorSurname(x.authors[0]) === authorSurname(y.authors[0]));

/** Best-first, without repeats of the same book. */
export function rankCandidates(d: Pick<DetectedBook, "title" | "authors">, candidates: BookMetadata[]) {
  const scored = candidates
    .map((c, i) => ({ c, i, score: scoreCandidate(d, c) }))
    .sort((x, y) => y.score - x.score || x.i - y.i);
  const kept: { c: BookMetadata; score: number }[] = [];
  for (const s of scored) if (!kept.some((k) => sameBook(k.c, s.c))) kept.push({ c: s.c, score: s.score });
  return kept;
}

export type Resolution = { best: BookMetadata | null; alternates: BookMetadata[]; via: "isbn" | "search" | "none" };

export async function resolveDetection(d: DetectedBook, deps: Lookups): Promise<Resolution> {
  let best: BookMetadata | null = null;
  let via: Resolution["via"] = "none";

  if (d.isbn) {
    try {
      const hit = await deps.lookupByIsbn(d.isbn);
      if (hit && scoreCandidate(d, hit) >= ISBN_AGREE_THRESHOLD) {
        best = hit;
        via = "isbn";
      }
    } catch {
      // A failed lookup just means the search below carries it.
    }
  }

  let hits: BookMetadata[] = [];
  try {
    hits = await deps.search(`${d.title} ${d.authors[0] ?? ""}`.trim());
  } catch {
    hits = [];
  }
  const ranked = rankCandidates(d, hits).filter((r) => !best || !sameBook(r.c, best));

  if (!best && ranked[0] && ranked[0].score >= MATCH_THRESHOLD) {
    best = ranked.shift()!.c;
    via = "search";
  }
  const alternates = ranked
    .filter((r) => r.score >= ALTERNATE_THRESHOLD)
    .slice(0, MAX_ALTERNATES)
    .map((r) => r.c);
  return { best, alternates, via };
}

/** Resolves every detection, a few at a time, keeping the shelf order. */
export async function resolveAll(detections: DetectedBook[], deps: Lookups, concurrency = 4): Promise<Resolution[]> {
  const run = createLimiter(concurrency);
  return Promise.all(detections.map((d) => run(() => resolveDetection(d, deps))));
}

/** One row of the review screen, as stored in scan_jobs.detected. */
export type ScanItem = {
  id: string;
  detected: DetectedBook;
  best: BookMetadata | null;
  alternates: BookMetadata[];
  via: Resolution["via"];
  /** Matches of `best` already in the library (empty when unmatched). */
  duplicates: TrayDuplicate[];
};

export function toScanItems(detections: DetectedBook[], resolutions: Resolution[], duplicates: TrayDuplicate[][]): ScanItem[] {
  return detections.map((detected, i) => ({
    id: `p${i}`,
    detected,
    best: resolutions[i].best,
    alternates: resolutions[i].alternates,
    via: resolutions[i].via,
    duplicates: duplicates[i] ?? [],
  }));
}
