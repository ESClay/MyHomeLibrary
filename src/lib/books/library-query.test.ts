import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applyLibraryQuery,
  libraryHref,
  parseLibraryParams,
  paramsToRaw,
  SORTS,
  queryTerms,
  compareItems,
  type LibraryItem,
} from "./library-query";
import { FIXTURE_CASES, FIXTURE_ITEMS } from "./library-fixture";

function item(over: Partial<LibraryItem> & { id: string; title: string }): LibraryItem {
  return {
    authors: [],
    seriesName: null,
    seriesPosition: null,
    coverUrl: null,
    ownership: "owned",
    publicRating: null,
    createdAt: "2026-01-01T00:00:00Z",
    formats: [],
    totalPaid: null,
    mine: null,
    others: [],
    loans: [],
    ...over,
  };
}

const items: LibraryItem[] = [
  item({ id: "1", title: "The Fellowship of the Ring", authors: ["J.R.R. Tolkien"], seriesName: "Lord of the Rings", seriesPosition: 1, formats: ["hardcover"], totalPaid: 20, mine: { status: "read", rating: 5 }, others: [{ userId: "u2", status: "reading" }], publicRating: 4.4, createdAt: "2026-01-03T00:00:00Z" }),
  item({ id: "2", title: "The Two Towers", authors: ["J.R.R. Tolkien"], seriesName: "Lord of the Rings", seriesPosition: 2, formats: ["paperback"], totalPaid: 10, mine: { status: "reading", rating: null }, publicRating: 4.5, createdAt: "2026-01-02T00:00:00Z" }),
  item({ id: "3", title: "Éclair", authors: ["Anne Brontë"], ownership: "wishlist", mine: { status: "want", rating: 3.5 }, publicRating: 3.9, createdAt: "2026-01-05T00:00:00Z" }),
  item({ id: "4", title: "A Study in Scarlet", authors: ["Arthur Conan Doyle"], formats: ["ebook", "paperback"], totalPaid: null, createdAt: "2026-01-04T00:00:00Z" }),
];

const ids = (list: LibraryItem[]) => list.map((i) => i.id);
const q = (raw: Record<string, string>) => applyLibraryQuery(items, parseLibraryParams(raw));

describe("saved sort fallback", () => {
  const saved = { sort: "title", dir: "desc" } as const;
  it("is used when the URL has no sort", () => {
    expect(parseLibraryParams({}, saved)).toMatchObject({ sort: "title", dir: "desc" });
    expect(parseLibraryParams({ sort: "nope" }, saved)).toMatchObject({ sort: "title", dir: "desc" });
  });
  it("takes the URL dir over the saved one when the sort comes from the fallback", () => {
    expect(parseLibraryParams({ dir: "asc" }, saved)).toMatchObject({ sort: "title", dir: "asc" });
  });
  it("loses to a valid URL sort, which uses the URL dir or its own default", () => {
    expect(parseLibraryParams({ sort: "price" }, saved)).toMatchObject({ sort: "price", dir: "desc" });
    expect(parseLibraryParams({ sort: "series" }, saved)).toMatchObject({ sort: "series", dir: "asc" });
    expect(parseLibraryParams({ sort: "series", dir: "desc" }, saved)).toMatchObject({ sort: "series", dir: "desc" });
  });
  it("is ignored when null", () => {
    expect(parseLibraryParams({}, null)).toMatchObject({ sort: "author", dir: "asc" });
  });
  it("round-trips through paramsToRaw, even against a different fallback", () => {
    const p = parseLibraryParams({}, saved);
    expect(paramsToRaw(p)).toMatchObject({ sort: "title", dir: "desc" });
    expect(parseLibraryParams(paramsToRaw(p), { sort: "price", dir: "asc" })).toEqual(p);
  });
  it("does not count sort as a filter", () => {
    expect(activeFilterCount(parseLibraryParams({}, saved))).toBe(0);
  });
});

describe("parseLibraryParams", () => {
  it("falls back to defaults for junk", () => {
    const p = parseLibraryParams({ sort: "nope", my: "zzz", limit: "5", rating: "9", format: "vinyl" });
    expect(p).toMatchObject({ sort: "author", dir: "asc", my: null, rating: null, format: null });
  });
  it("ignores an old ?limit=", () => {
    const p = parseLibraryParams({ limit: "96" });
    expect(p).not.toHaveProperty("limit");
    expect(libraryHref(p)).toBe("/library?sort=author&dir=asc");
  });
  it("keeps valid values and per-sort default direction", () => {
    const p = parseLibraryParams({ sort: "title", my: "none", rating: "unrated", limit: "96", series: "X" });
    expect(p).toMatchObject({ sort: "title", dir: "asc", my: "none", rating: "unrated", series: "X" });
  });
  it("round-trips through libraryHref, which always carries sort and dir", () => {
    expect(libraryHref(parseLibraryParams({}))).toBe("/library?sort=author&dir=asc");
    const p = parseLibraryParams({ q: "ring", sort: "price", dir: "asc", own: "wishlist", limit: "96" });
    expect(parseLibraryParams(Object.fromEntries(new URLSearchParams(libraryHref(p).split("?")[1])))).toEqual(p);
  });
});

describe("filters", () => {
  it("searches title, author and series, ignoring case and accents", () => {
    expect(ids(q({ q: "eclair" }))).toEqual(["3"]);
    expect(ids(q({ q: "tolkien", sort: "title" }))).toEqual(["1", "2"]);
    expect(ids(q({ q: "lord rings", sort: "title" }))).toEqual(["1", "2"]);
  });
  it("filters by my status, including none", () => {
    expect(ids(q({ my: "read" }))).toEqual(["1"]);
    expect(ids(q({ my: "none" }))).toEqual(["4"]);
  });
  it("filters by any other member's status", () => {
    expect(ids(q({ partner: "reading" }))).toEqual(["1"]);
    expect(ids(q({ partner: "read" }))).toEqual([]);
  });
  it("filters by format, ownership, series and rating", () => {
    expect(ids(q({ format: "paperback", sort: "title" }))).toEqual(["4", "2"]);
    expect(ids(q({ own: "wishlist" }))).toEqual(["3"]);
    expect(ids(q({ series: "Lord of the Rings", sort: "title" }))).toEqual(["1", "2"]);
    expect(ids(q({ rating: "4", sort: "title" }))).toEqual(["1"]);
    expect(ids(q({ rating: "unrated", sort: "title" }))).toEqual(["4", "2"]);
  });
  it("combines filters", () => {
    expect(ids(q({ q: "tolkien", format: "paperback" }))).toEqual(["2"]);
  });
});

describe("sorting", () => {
  it("sorts by title ignoring leading articles", () => {
    expect(ids(q({ sort: "title" }))).toEqual(["3", "1", "4", "2"]);
    // Éclair, Fellowship, Study, Two Towers
  });
  it("sorts by author last name", () => {
    expect(ids(q({ sort: "author" }))).toEqual(["3", "4", "1", "2"]);
  });
  it("defaults to author, with no sort or dir in the URL", () => {
    expect(parseLibraryParams({})).toMatchObject({ sort: "author", dir: "asc" });
    expect(ids(applyLibraryQuery(items, parseLibraryParams({})))).toEqual(ids(q({ sort: "author" })));
    expect(paramsToRaw(parseLibraryParams({}))).toEqual({ sort: "author", dir: "asc" });
    expect(paramsToRaw(parseLibraryParams({ sort: "added" }))).toEqual({ sort: "added", dir: "desc" });
    expect(SORTS[0]).toBe("author");
  });
  describe("author sort order", () => {
    const nums = (raw: Record<string, string>) =>
      applyLibraryQuery(FIXTURE_ITEMS, parseLibraryParams(raw)).map((i) => Number(i.id.slice(-12)));
    const sanderson = [24, 33, 25, 27, 26, 28];
    it("keeps an author's series together in reading order, standalones last", () => {
      const asc = nums({ sort: "author" });
      // Mistborn (1, then no position), Stormlight 1, 2, 2.5 (the novella), then the standalone
      expect(asc.filter((n) => sanderson.includes(n))).toEqual(sanderson);
    });
    it("keeps two authors who share a last name apart", () => {
      // Adam Smith's titles sit on both sides of Zadie Smith's, so only the full name keeps them apart
      expect(nums({ sort: "author" }).filter((n) => n >= 29 && n <= 32)).toEqual([29, 31, 30, 32]);
    });
    it("descending flips only the author keys, the series order stays ascending", () => {
      const desc = nums({ sort: "author", dir: "desc" });
      expect(desc.filter((n) => sanderson.includes(n))).toEqual(sanderson);
      expect(desc.filter((n) => n >= 29 && n <= 32)).toEqual([30, 32, 29, 31]);
      expect(desc[0]).toBe(7); // no author first
      expect(nums({ sort: "author" }).at(-1)).toBe(7); // and last ascending
    });
  });
  it("sorts by series order with standalone books last", () => {
    expect(ids(q({ sort: "series" }))).toEqual(["1", "2", "3", "4"]);
  });
  it("sorts by date added, newest first by default", () => {
    expect(ids(q({ sort: "added" }))).toEqual(["3", "4", "1", "2"]);
  });
  it("sorts by my rating and keeps unrated last in both directions", () => {
    expect(ids(q({ sort: "myrating" }))).toEqual(["1", "3", "4", "2"]);
    expect(ids(q({ sort: "myrating", dir: "asc" }))).toEqual(["3", "1", "4", "2"]);
  });
  it("sorts by public rating and purchase price with blanks last", () => {
    expect(ids(q({ sort: "rating" }))).toEqual(["2", "1", "3", "4"]);
    expect(ids(q({ sort: "price" }))).toEqual(["1", "2", "3", "4"]);
    expect(ids(q({ sort: "price", dir: "asc" }))).toEqual(["2", "1", "3", "4"]);
  });
});

describe("loan filters", () => {
  const out = { id: "l1", direction: "out" as const, borrowerName: "Sam", dueAt: "2026-12-01T00:00:00Z", overdue: false };
  const late = { id: "l2", direction: "out" as const, borrowerName: "Kim", dueAt: "2026-01-01T00:00:00Z", overdue: true };
  const books = [
    item({ id: "a", title: "A", loans: [out] }),
    item({ id: "b", title: "B", loans: [late] }),
    item({ id: "c", title: "C", ownership: "borrowed", loans: [{ id: "l3", direction: "in", borrowerName: "Ana", dueAt: null, overdue: false }] }),
    item({ id: "d", title: "D" }),
  ];
  const ids = (loan: string) => applyLibraryQuery(books, parseLibraryParams({ loan })).map((i) => i.id).sort();

  it("finds books on loan, overdue, and borrowed", () => {
    expect(ids("out")).toEqual(["a", "b"]);
    expect(ids("overdue")).toEqual(["b"]);
    expect(ids("borrowed")).toEqual(["c"]);
  });

  it("ignores an unknown value and counts the filter as active", () => {
    expect(parseLibraryParams({ loan: "nonsense" }).loan).toBeNull();
    expect(activeFilterCount(parseLibraryParams({ loan: "out" }))).toBe(1);
    expect(libraryHref(parseLibraryParams({ loan: "overdue" }))).toBe("/library?loan=overdue&sort=author&dir=asc");
  });
});

describe("the shared fixture (the same cases are asserted in supabase/tests/library_page.test.sql)", () => {
  for (const c of FIXTURE_CASES) {
    it(c.name, () => {
      const got = applyLibraryQuery(FIXTURE_ITEMS, parseLibraryParams(c.raw)).map((i) => Number(i.id.slice(-12)));
      expect(got).toEqual(c.expected);
    });
  }
  it("compareItems ends on the id, whatever the input order", () => {
    const [a, b] = FIXTURE_ITEMS.filter((i) => i.title.toLowerCase() === "twin title");
    expect(compareItems(a, b, "title", "asc")).toBe(-1);
    expect(compareItems(b, a, "title", "asc")).toBe(1);
    expect(compareItems(b, a, "title", "desc")).toBe(1);
    expect(compareItems(a, a, "title", "asc")).toBe(0);
  });
});

describe("queryTerms", () => {
  it("folds accents and case and splits on any whitespace", () => {
    expect(queryTerms("  ÉCLAIR\t Études ")).toEqual(["eclair", "etudes"]);
    expect(queryTerms("   ")).toEqual([]);
  });
});
