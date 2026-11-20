/**
 * Filtering and ordering of the Discover series list. Pure, so the list can be tested without a browser.
 */
import type { SeriesGap } from "./gaps";

export type SeriesSort = "fewest" | "az" | "most";

export const SERIES_SORTS: { value: SeriesSort; label: string }[] = [
  { value: "fewest", label: "Fewest missing first" },
  { value: "az", label: "A to Z" },
  { value: "most", label: "Most missing" },
];

export const DEFAULT_SERIES_SORT: SeriesSort = "fewest";

/** Case- and accent-insensitive form of a string, with runs of whitespace collapsed. */
export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSeriesSort(v: string | null | undefined): SeriesSort {
  return v === "az" || v === "most" || v === "fewest" ? v : DEFAULT_SERIES_SORT;
}

/** A series still waiting for its first lookup has no known missing count; it sorts last in the count orders. */
const missingOf = (g: SeriesGap) => (g.pending ? null : g.missing.length);

const byName = (a: SeriesGap, b: SeriesGap) => a.series.name.localeCompare(b.series.name, undefined, { sensitivity: "base", numeric: true });

/** Keeps the series whose name or author contains the query, then orders them. Does not mutate the input. */
export function viewSeries(gaps: SeriesGap[], query: string, sort: SeriesSort): SeriesGap[] {
  const q = foldText(query);
  const kept = q ? gaps.filter((g) => foldText(g.series.name).includes(q) || foldText(g.series.authorName ?? "").includes(q)) : [...gaps];
  return kept.sort((a, b) => {
    if (sort !== "az") {
      const ma = missingOf(a);
      const mb = missingOf(b);
      if (ma !== mb) {
        if (ma === null) return 1;
        if (mb === null) return -1;
        return sort === "fewest" ? ma - mb : mb - ma;
      }
    }
    return byName(a, b);
  });
}

/** Total missing volumes across the given series (pending ones count as none). */
export function totalMissing(gaps: SeriesGap[]): number {
  return gaps.reduce((n, g) => n + (g.pending ? 0 : g.missing.length), 0);
}
