import type { Format, Ownership, Status } from "./constants";
import type { LibraryItem } from "./library-query";

/**
 * One small library used by BOTH the vitest reference tests (applyLibraryQuery) and the pgTAP tests of the SQL function
 * (supabase/tests/library_page.test.sql). The rows are inserted there with the same values and each case lists the
 * same expected order, so if the JS and the SQL ever drift one of the two suites fails.
 * "Me" is alice, the other member is bob. `now` is any day after 2020-01-01 and before 2099-01-01.
 */
export const fid = (n: number) => `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export const FIXTURE_ME = "a0000000-0000-0000-0000-000000000001";
export const FIXTURE_BOB = "b0000000-0000-0000-0000-000000000002";

type Raw = {
  n: number;
  title: string;
  authors: string[];
  series?: [string, number | null];
  own?: Ownership;
  pub?: number;
  created: string;
  copies?: [Format, number | null][];
  mine?: [Status, number | null];
  bob?: Status;
  /** An active loan: direction and due date (null = none). A returned loan is not listed, it is not active. */
  loan?: { direction: "out" | "in"; due: string | null };
};

const RAW: Raw[] = [
  { n: 1, title: "The Hobbit", authors: ["Tolkien, J. R. R."], series: ["Middle-earth", 1], pub: 4.5, created: "2026-01-01T10:00:00Z", copies: [["hardcover", 12.5], ["ebook", null]], mine: ["read", 5], bob: "read" },
  { n: 2, title: "The Fellowship of the Ring", authors: ["J. R. R. Tolkien"], series: ["Middle-earth", 2], pub: 4.4, created: "2026-01-02T10:00:00Z", copies: [["paperback", 9]], mine: ["reading", 4], bob: "reading", loan: { direction: "out", due: "2099-01-01T00:00:00Z" } },
  { n: 3, title: "Éclair Études", authors: ["Zoë Brontë"], created: "2026-01-03T10:00:00Z", copies: [["ebook", null]], mine: ["want", null] },
  { n: 4, title: "A Tale of Two Cities", authors: ["Charles Dickens"], pub: 3.9, created: "2026-01-04T10:00:00Z", copies: [["paperback", 5], ["paperback", 3.25]], bob: "want", loan: { direction: "out", due: "2020-01-01T00:00:00Z" } },
  { n: 5, title: "Book 2", authors: ["Ann Alpha"], series: ["Saga", 2], own: "wishlist", pub: 4, created: "2026-01-05T10:00:00Z" },
  { n: 6, title: "Book 10", authors: ["Ann Alpha"], series: ["Saga", 10], own: "wishlist", pub: 4, created: "2026-01-06T10:00:00Z" },
  { n: 7, title: "An Anthology", authors: [], pub: 2, created: "2026-01-07T10:00:00Z", copies: [["audiobook", 20]], mine: ["dnf", 2.5] },
  { n: 8, title: "Returned Book", authors: ["Dickens, Monica"], series: ["Saga", 1], created: "2026-01-08T10:00:00Z", copies: [["hardcover", 7]], mine: ["read", 3.5], bob: "reading" },
  { n: 9, title: "Borrowed Book", authors: ["Mary Moon"], own: "borrowed", pub: 3, created: "2026-01-09T10:00:00Z", mine: ["want", 1], loan: { direction: "in", due: "2020-01-01T00:00:00Z" } },
  { n: 10, title: "Twin Title", authors: ["Zed Zimmer"], series: ["Saga", null], pub: 3, created: "2026-01-10T10:00:00Z", copies: [["paperback", 10]] },
  { n: 11, title: "twin title", authors: ["Zed Zimmer"], series: ["Saga", null], pub: 3, created: "2026-01-10T10:00:00Z", mine: ["read", 5] },
  { n: 12, title: "The Zebra", authors: ["Zora Neale"], pub: 5, created: "2026-01-11T10:00:00Z", copies: [["paperback", 10]] },
  { n: 13, title: "100% Pure", authors: ["Pat Percent"], created: "2026-01-12T10:00:00Z" },
];

export const FIXTURE_RAW = RAW;

export const FIXTURE_ITEMS: LibraryItem[] = RAW.map((r) => {
  const prices = (r.copies ?? []).map((c) => c[1]).filter((p): p is number => p !== null);
  return {
    id: fid(r.n),
    title: r.title,
    authors: r.authors,
    seriesName: r.series?.[0] ?? null,
    seriesPosition: r.series?.[1] ?? null,
    coverUrl: null,
    ownership: r.own ?? "owned",
    publicRating: r.pub ?? null,
    createdAt: r.created,
    formats: [...new Set((r.copies ?? []).map((c) => c[0]))],
    totalPaid: prices.length ? prices.reduce((a, b) => a + b, 0) : null,
    mine: r.mine ? { status: r.mine[0], rating: r.mine[1] } : null,
    others: r.bob ? [{ userId: FIXTURE_BOB, status: r.bob }] : [],
    loans: r.loan ? [{ id: `loan-${r.n}`, direction: r.loan.direction, borrowerName: "Sam", dueAt: r.loan.due, overdue: r.loan.due !== null && r.loan.due < "2026-06-01" }] : [],
  };
});

/**
 * Each case is a set of library URL params and the fixture book numbers (`n` in RAW) it must return, in order.
 * supabase/tests/library_page.test.sql lists the same cases with the same expected order.
 */
export const FIXTURE_CASES: { name: string; raw: Record<string, string>; expected: number[] }[] = [
  { name: "default sort is newest first, title then id on a tie", raw: {}, expected: [13, 12, 10, 11, 9, 8, 7, 6, 5, 4, 3, 2, 1] },
  { name: "title ascending: articles ignored, numbers numeric, case ignored, id breaks the tie", raw: { sort: "title" }, expected: [13, 7, 5, 6, 9, 3, 2, 1, 8, 4, 10, 11, 12] },
  { name: "title descending", raw: { sort: "title", dir: "desc" }, expected: [12, 10, 11, 4, 8, 1, 2, 3, 9, 6, 5, 7, 13] },
  { name: "author ascending: last name, comma form, missing author last", raw: { sort: "author" }, expected: [5, 6, 3, 8, 4, 9, 12, 13, 2, 1, 10, 11, 7] },
  { name: "author descending puts a missing author first", raw: { sort: "author", dir: "desc" }, expected: [7, 10, 11, 2, 1, 13, 12, 9, 8, 4, 3, 5, 6] },
  { name: "series ascending: no series last, then position with nulls last", raw: { sort: "series" }, expected: [1, 2, 8, 5, 6, 10, 11, 13, 7, 9, 3, 4, 12] },
  { name: "series descending keeps no series last", raw: { sort: "series", dir: "desc" }, expected: [6, 5, 8, 10, 11, 2, 1, 13, 7, 9, 3, 4, 12] },
  { name: "date added ascending", raw: { sort: "added", dir: "asc" }, expected: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
  { name: "my rating descending: unrated last", raw: { sort: "myrating" }, expected: [1, 11, 2, 8, 7, 9, 13, 5, 6, 3, 4, 10, 12] },
  { name: "my rating ascending: unrated still last", raw: { sort: "myrating", dir: "asc" }, expected: [9, 7, 8, 2, 1, 11, 13, 5, 6, 3, 4, 10, 12] },
  { name: "public rating descending: unrated last", raw: { sort: "rating" }, expected: [12, 1, 2, 5, 6, 4, 9, 10, 11, 7, 13, 3, 8] },
  { name: "public rating ascending: unrated still last", raw: { sort: "rating", dir: "asc" }, expected: [7, 9, 10, 11, 4, 5, 6, 2, 1, 12, 13, 3, 8] },
  { name: "price descending: sum of copies, none last", raw: { sort: "price" }, expected: [7, 1, 10, 12, 2, 4, 8, 13, 5, 6, 9, 3, 11] },
  { name: "price ascending: none still last", raw: { sort: "price", dir: "asc" }, expected: [8, 4, 2, 10, 12, 1, 7, 13, 5, 6, 9, 3, 11] },
  { name: "search ignores accents and case", raw: { q: "ECLAIR etudes", sort: "title" }, expected: [3] },
  { name: "search finds an author with an accent", raw: { q: "zoe", sort: "title" }, expected: [3] },
  { name: "search matches author and series, every term", raw: { q: "saga alp", sort: "title" }, expected: [5, 6] },
  { name: "search terms may sit in different words", raw: { q: "tale cities", sort: "title" }, expected: [4] },
  { name: "search splits on any run of spaces", raw: { q: "hobbit  tolkien" }, expected: [1] },
  { name: "search treats a percent sign literally", raw: { q: "100%", sort: "title" }, expected: [13] },
  { name: "search treats an underscore literally", raw: { q: "e_t" }, expected: [] },
  { name: "my status read", raw: { my: "read", sort: "title" }, expected: [1, 8, 11] },
  { name: "my status want", raw: { my: "want", sort: "title" }, expected: [9, 3] },
  { name: "my status none: no row at all", raw: { my: "none", sort: "title" }, expected: [13, 5, 6, 4, 10, 12] },
  { name: "partner reading", raw: { partner: "reading", sort: "title" }, expected: [2, 8] },
  { name: "partner read", raw: { partner: "read", sort: "title" }, expected: [1] },
  { name: "format ebook", raw: { format: "ebook", sort: "title" }, expected: [3, 1] },
  { name: "format paperback", raw: { format: "paperback", sort: "title" }, expected: [2, 4, 10, 12] },
  { name: "ownership wishlist", raw: { own: "wishlist", sort: "title" }, expected: [5, 6] },
  { name: "ownership owned", raw: { own: "owned", sort: "title" }, expected: [13, 7, 3, 2, 1, 8, 4, 10, 11, 12] },
  { name: "series name", raw: { series: "Saga", sort: "series" }, expected: [8, 5, 6, 10, 11] },
  { name: "loan out: active lends only", raw: { loan: "out", sort: "title" }, expected: [2, 4] },
  { name: "loan overdue: active, due day passed, either direction", raw: { loan: "overdue", sort: "title" }, expected: [9, 4] },
  { name: "loan borrowed: ownership borrowed", raw: { loan: "borrowed", sort: "title" }, expected: [9] },
  { name: "rating at least 4", raw: { rating: "4", sort: "title" }, expected: [2, 1, 11] },
  { name: "rating at least 3.5", raw: { rating: "3.5", sort: "title" }, expected: [2, 1, 8, 11] },
  { name: "rating unrated: null or no row", raw: { rating: "unrated", sort: "title" }, expected: [13, 5, 6, 3, 4, 10, 12] },
  { name: "filters combine", raw: { own: "owned", my: "read", sort: "title", dir: "desc" }, expected: [11, 8, 1] },
];
