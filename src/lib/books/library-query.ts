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
};

export const SORTS = ["added", "title", "author", "series", "myrating", "rating", "price"] as const;
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

export const PAGE_SIZE = 48;
export const MAX_LIMIT = 2000;

export type LibraryParams = {
  q: string;
  /** my reading status, or "none" for books I have no status on */
  my: Status | "none" | null;
  /** status of any other member */
  partner: Status | null;
  format: Format | null;
  own: Ownership | null;
  series: string | null;
  /** minimum my-rating, or "unrated" */
  rating: number | "unrated" | null;
  sort: Sort;
  dir: "asc" | "desc";
  /** how many results to show */
  limit: number;
};

type Raw = Record<string, string | string[] | undefined>;

function one(raw: Raw, key: string): string | undefined {
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
}

function oneOf<T extends string>(v: string | undefined, allowed: readonly T[]): T | null {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** Reads and validates library URL params; unknown values fall back to defaults. */
export function parseLibraryParams(raw: Raw): LibraryParams {
  const sort = oneOf(one(raw, "sort"), SORTS) ?? "added";
  const dir = oneOf(one(raw, "dir"), ["asc", "desc"] as const) ?? DEFAULT_DIR[sort];
  const ratingRaw = one(raw, "rating");
  const ratingNum = ratingRaw ? Number(ratingRaw) : NaN;
  const limit = Number(one(raw, "limit"));
  return {
    q: (one(raw, "q") ?? "").slice(0, 100),
    my: oneOf(one(raw, "my"), [...STATUSES, "none"] as const),
    partner: oneOf(one(raw, "partner"), STATUSES),
    format: oneOf(one(raw, "format"), FORMATS),
    own: oneOf(one(raw, "own"), ["owned", "wishlist"] as const),
    series: one(raw, "series") ?? null,
    rating:
      ratingRaw === "unrated"
        ? "unrated"
        : Number.isFinite(ratingNum) && ratingNum >= 0.5 && ratingNum <= 5
          ? ratingNum
          : null,
    sort,
    dir,
    limit: Number.isFinite(limit) && limit >= PAGE_SIZE ? Math.min(Math.floor(limit), MAX_LIMIT) : PAGE_SIZE,
  };
}

/** Serializes params for a URL, omitting defaults. `overrides` replace fields. */
export function libraryHref(params: LibraryParams, overrides: Partial<LibraryParams> = {}): string {
  const p = { ...params, ...overrides };
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.my) sp.set("my", p.my);
  if (p.partner) sp.set("partner", p.partner);
  if (p.format) sp.set("format", p.format);
  if (p.own) sp.set("own", p.own);
  if (p.series) sp.set("series", p.series);
  if (p.rating !== null) sp.set("rating", String(p.rating));
  if (p.sort !== "added") sp.set("sort", p.sort);
  if (p.dir !== DEFAULT_DIR[p.sort]) sp.set("dir", p.dir);
  if (p.limit > PAGE_SIZE) sp.set("limit", String(p.limit));
  const s = sp.toString();
  return s ? `/library?${s}` : "/library";
}

export function activeFilterCount(p: LibraryParams): number {
  return [p.my, p.partner, p.format, p.own, p.series, p.rating].filter((v) => v !== null).length;
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function matchesQuery(item: LibraryItem, q: string): boolean {
  const terms = fold(q).split(/\s+/).filter(Boolean);
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

export function compareItems(a: LibraryItem, b: LibraryItem, sort: Sort, dir: "asc" | "desc"): number {
  const sign = dir === "asc" ? 1 : -1;
  const byTitle = () => collator.compare(sortTitle(a.title), sortTitle(b.title));
  let r = 0;
  switch (sort) {
    case "title":
      return sign * byTitle();
    case "author":
      r = collator.compare(lastName(a.authors[0]), lastName(b.authors[0]));
      return r !== 0 ? sign * r : byTitle();
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
