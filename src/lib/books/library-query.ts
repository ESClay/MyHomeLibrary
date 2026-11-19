import type { ActiveLoan } from "@/lib/loans/rules";
import { STATUSES, FORMATS, type Format, type Ownership, type Status } from "./constants";

/** One book as the library list needs it. */
export type LibraryItem = {
  id: string;
  title: string;
  authors: string[];
  seriesName: string | null;
  seriesPosition: number | null;
  coverUrl: string | null;
  ownership: Ownership;
  publicRating: number | null;
  createdAt: string;
  formats: Format[];
  /** Sum of purchase prices over all copies, or null when none is recorded. */
  totalPaid: number | null;
  mine: { status: Status; rating: number | null } | null;
  others: { userId: string; status: Status }[];
  /** Loans still out (lent by us, or borrowed by us), most urgent first. */
  loans: ActiveLoan[];
};

export const LOAN_FILTERS = ["out", "overdue", "borrowed"] as const;
export type LoanFilter = (typeof LOAN_FILTERS)[number];
export const LOAN_FILTER_LABEL: Record<LoanFilter, string> = { out: "On loan", overdue: "Overdue", borrowed: "Borrowed" };

export const SORTS = ["author", "added", "title", "series", "myrating", "rating", "price"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABEL: Record<Sort, string> = {
  added: "Date added",
  title: "Title",
  author: "Author",
  series: "Series order",
  myrating: "My rating",
  rating: "Public rating",
  price: "Purchase price",
};
const DEFAULT_DIR: Record<Sort, "asc" | "desc"> = {
  added: "desc",
  title: "asc",
  author: "asc",
  series: "asc",
  myrating: "desc",
  rating: "desc",
  price: "desc",
};

export function defaultDir(sort: Sort): "asc" | "desc" {
  return DEFAULT_DIR[sort];
}

/** What the library sorts by when neither the URL nor the saved preference has a sort. */
export const DEFAULT_SORT: Sort = "author";

export const PAGE_SIZE = 48;

export type LibraryParams = {
  q: string;
  /** my reading status, or "none" for books I have no status on */
  my: Status | "none" | null;
  /** status of any other member */
  partner: Status | null;
  format: Format | null;
  own: "owned" | "wishlist" | null;
  series: string | null;
  /** lending: lent out, overdue, or borrowed by us */
  loan: LoanFilter | null;
  /** minimum my-rating, or "unrated" */
  rating: number | "unrated" | null;
  sort: Sort;
  dir: "asc" | "desc";
};

type Raw = Record<string, string | string[] | undefined>;

function one(raw: Raw, key: string): string | undefined {
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
}

function oneOf<T extends string>(v: string | undefined, allowed: readonly T[]): T | null {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** A saved sort preference (from the profile), used when the URL names no valid sort. */
export type SortFallback = { sort: Sort; dir: "asc" | "desc" };

/**
 * Reads and validates library URL params; unknown values fall back to defaults. An old `?limit=` is ignored (the list pages itself).
 * The sort comes from the URL when it is valid, else from `fallback` (the saved preference), else DEFAULT_SORT. With a URL sort,
 * `dir` is the URL's or that sort's default; with a fallback sort, it is the URL's `dir` if present, else the saved one.
 */
export function parseLibraryParams(raw: Raw, fallback?: SortFallback | null): LibraryParams {
  const urlSort = oneOf(one(raw, "sort"), SORTS);
  const urlDir = oneOf(one(raw, "dir"), ["asc", "desc"] as const);
  const sort = urlSort ?? fallback?.sort ?? DEFAULT_SORT;
  const dir = urlSort ? (urlDir ?? DEFAULT_DIR[sort]) : fallback ? (urlDir ?? fallback.dir) : (urlDir ?? DEFAULT_DIR[sort]);
  const ratingRaw = one(raw, "rating");
  const ratingNum = ratingRaw ? Number(ratingRaw) : NaN;
  return {
    q: (one(raw, "q") ?? "").slice(0, 100),
    my: oneOf(one(raw, "my"), [...STATUSES, "none"] as const),
    partner: oneOf(one(raw, "partner"), STATUSES),
    format: oneOf(one(raw, "format"), FORMATS),
    own: oneOf(one(raw, "own"), ["owned", "wishlist"] as const),
    series: one(raw, "series") ?? null,
    loan: oneOf(one(raw, "loan"), LOAN_FILTERS),
    rating:
      ratingRaw === "unrated"
        ? "unrated"
        : Number.isFinite(ratingNum) && ratingNum >= 0.5 && ratingNum <= 5
          ? ratingNum
          : null,
    sort,
    dir,
  };
}

/**
 * Params as the raw string map the URL carries. Filters at their default are omitted, but `sort` and `dir` are always
 * written: once the URL carries a sort it wins over the saved preference. Parsing it back gives the same params.
 */
export function paramsToRaw(p: LibraryParams): Record<string, string> {
  const raw: Record<string, string> = {};
  if (p.q) raw.q = p.q;
  if (p.my) raw.my = p.my;
  if (p.partner) raw.partner = p.partner;
  if (p.format) raw.format = p.format;
  if (p.own) raw.own = p.own;
  if (p.series) raw.series = p.series;
  if (p.loan) raw.loan = p.loan;
  if (p.rating !== null) raw.rating = String(p.rating);
  raw.sort = p.sort;
  raw.dir = p.dir;
  return raw;
}

/** Serializes params for a URL (always with sort and direction). `overrides` replace fields. */
export function libraryHref(params: LibraryParams, overrides: Partial<LibraryParams> = {}): string {
  const s = new URLSearchParams(paramsToRaw({ ...params, ...overrides })).toString();
  return s ? `/library?${s}` : "/library";
}

export function activeFilterCount(p: LibraryParams): number {
  return [p.my, p.partner, p.format, p.own, p.series, p.loan, p.rating].filter((v) => v !== null).length;
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** The search terms of a query: folded, split on whitespace. `library_page` matches each as a substring of `search_folded`. */
export function queryTerms(q: string): string[] {
  return fold(q).split(/\s+/).filter(Boolean);
}

export function matchesQuery(item: LibraryItem, q: string): boolean {
  const terms = queryTerms(q);
  if (terms.length === 0) return true;
  const hay = fold([item.title, ...item.authors, item.seriesName ?? ""].join(" "));
  return terms.every((t) => hay.includes(t));
}

export function matchesFilters(item: LibraryItem, p: LibraryParams): boolean {
  if (p.q && !matchesQuery(item, p.q)) return false;
  if (p.my) {
    if (p.my === "none" ? item.mine !== null : item.mine?.status !== p.my) return false;
  }
  if (p.partner && !item.others.some((o) => o.status === p.partner)) return false;
  if (p.format && !item.formats.includes(p.format)) return false;
  if (p.own && item.ownership !== p.own) return false;
  if (p.series && item.seriesName !== p.series) return false;
  if (p.loan === "out" && !item.loans.some((l) => l.direction === "out")) return false;
  if (p.loan === "overdue" && !item.loans.some((l) => l.overdue)) return false;
  if (p.loan === "borrowed" && item.ownership !== "borrowed") return false;
  if (p.rating === "unrated") {
    if (item.mine?.rating != null) return false;
  } else if (p.rating !== null) {
    if ((item.mine?.rating ?? 0) < p.rating) return false;
  }
  return true;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Sort-friendly title: ignores a leading article. */
function sortTitle(t: string): string {
  return t.replace(/^(the|a|an)\s+/i, "");
}

function lastName(author: string | undefined): string {
  if (!author) return "￿";
  const comma = author.indexOf(",");
  if (comma > 0) return author.slice(0, comma);
  const words = author.trim().split(/\s+/);
  return words[words.length - 1] ?? author;
}

/** Null values always sort last, whichever the direction. */
function numeric(a: number | null, b: number | null, dir: "asc" | "desc"): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

/**
 * The reference order. `library_page` (supabase/migrations/20261122000000_library_page.sql) reproduces it in SQL, and
 * both tests use one fixture. Ties end on the book id so a page boundary never moves between requests.
 */
export function compareItems(a: LibraryItem, b: LibraryItem, sort: Sort, dir: "asc" | "desc"): number {
  return compareByKey(a, b, sort, dir) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function compareByKey(a: LibraryItem, b: LibraryItem, sort: Sort, dir: "asc" | "desc"): number {
  const sign = dir === "asc" ? 1 : -1;
  const byTitle = () => collator.compare(sortTitle(a.title), sortTitle(b.title));
  let r = 0;
  switch (sort) {
    case "title":
      return sign * byTitle();
    case "author": {
      // Last name, then full name (both follow the direction); then series before no series, series name, and position,
      // always ascending; then title. A missing author is U+FFFF in both author keys, as in SQL (NULL).
      r = collator.compare(lastName(a.authors[0]), lastName(b.authors[0]));
      if (r !== 0) return sign * r;
      r = collator.compare(a.authors[0] || "￿", b.authors[0] || "￿");
      if (r !== 0) return sign * r;
      if (!a.seriesName !== !b.seriesName) return a.seriesName ? -1 : 1;
      if (a.seriesName && b.seriesName) {
        r = collator.compare(a.seriesName, b.seriesName);
        if (r !== 0) return r;
      }
      r = numeric(a.seriesPosition, b.seriesPosition, "asc");
      return r !== 0 ? r : byTitle();
    }
    case "series": {
      if (!a.seriesName && !b.seriesName) return byTitle();
      if (!a.seriesName) return 1;
      if (!b.seriesName) return -1;
      r = collator.compare(a.seriesName, b.seriesName);
      if (r !== 0) return sign * r;
      r = numeric(a.seriesPosition, b.seriesPosition, dir);
      return r !== 0 ? r : byTitle();
    }
    case "added":
      r = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      return r !== 0 ? sign * r : byTitle();
    case "myrating":
      r = numeric(a.mine?.rating ?? null, b.mine?.rating ?? null, dir);
      return r !== 0 ? r : byTitle();
    case "rating":
      r = numeric(a.publicRating, b.publicRating, dir);
      return r !== 0 ? r : byTitle();
    case "price":
      r = numeric(a.totalPaid, b.totalPaid, dir);
      return r !== 0 ? r : byTitle();
  }
}

export function applyLibraryQuery(items: LibraryItem[], p: LibraryParams): LibraryItem[] {
  return items.filter((i) => matchesFilters(i, p)).sort((a, b) => compareItems(a, b, p.sort, p.dir));
}
