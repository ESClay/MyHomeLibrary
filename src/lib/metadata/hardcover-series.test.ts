import { describe, expect, it } from "vitest";
import bookSeriesFixture from "./__fixtures__/hardcover-book-series.json";
import duneFixture from "./__fixtures__/hardcover-series-dune.json";
import searchFixture from "./__fixtures__/hardcover-series-search.json";
import witcherFixture from "./__fixtures__/hardcover-series-witcher.json";
import {
  chooseSeriesRef,
  isCompilationEntry,
  normalizeBookSeries,
  normalizeSeriesBooks,
  normalizeSeriesSearch,
  pickSeriesHit,
} from "./hardcover-series";

describe("normalizeBookSeries", () => {
  const links = normalizeBookSeries(bookSeriesFixture.data.books);

  it("reads every series a book is in, with its featured flag and position", () => {
    expect(links).toHaveLength(1);
    expect(links[0].bookId).toBe(312460);
    expect(links[0].series.map((s) => s.name)).toEqual(["Dune", "Dune Universe (Chronological)", "Dune Universe (Publication Order)"]);
    expect(links[0].series[0]).toMatchObject({ seriesId: 1150, featured: true, position: 1, compilation: false });
    expect(links[0].series[1]).toMatchObject({ featured: false, position: 21 });
  });

  it("skips merged series and bad rows", () => {
    const out = normalizeBookSeries([
      { id: 1, title: "A", book_series: [{ position: 1, featured: true, series: { id: 9, name: "Merged", canonical_id: 4, state: "duplicate" } }] },
      { id: 2, book_series: [{ position: 1, series: { id: 0, name: "" } }] },
      null,
      { title: "no id" },
    ]);
    expect(out).toEqual([
      { bookId: 1, title: "A", series: [] },
      { bookId: 2, title: null, series: [] },
    ]);
  });

  it("is empty for a non-array", () => {
    expect(normalizeBookSeries(null)).toEqual([]);
    expect(normalizeBookSeries({})).toEqual([]);
  });
});

describe("chooseSeriesRef", () => {
  const refs = normalizeBookSeries(bookSeriesFixture.data.books)[0].series;

  it("files a book under its featured series by default", () => {
    expect(chooseSeriesRef(refs, null)?.name).toBe("Dune");
  });

  it("prefers the series that matches the book's own series text", () => {
    expect(chooseSeriesRef(refs, "Dune Universe (Publication Order)")?.seriesId).toBe(168882);
    expect(chooseSeriesRef(refs, "dune series")?.seriesId).toBe(1150);
  });

  it("returns null with no usable series", () => {
    expect(chooseSeriesRef([], "x")).toBeNull();
    expect(chooseSeriesRef([{ seriesId: 1, name: "Box", featured: true, position: 1, compilation: true }], null)).toBeNull();
  });
});

describe("normalizeSeriesBooks", () => {
  it("reads Dune: ordered positions, authors, dates, ISBN and cover", () => {
    const s = normalizeSeriesBooks(duneFixture.data.series[0])!;
    expect(s).toMatchObject({ hardcoverId: 1150, name: "Dune", authorName: "Frank Herbert", booksCount: 19 });
    expect(s.entries.map((e) => e.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.skipped).toBe(1); // "Hunters of Dune" has no position
    const first = s.entries[0];
    expect(first).toMatchObject({
      title: "Dune",
      authors: ["Frank Herbert"],
      releaseDate: "1965-06-01",
      isbn13: "9780441172719",
      hardcoverBookId: 312460,
      isCompilation: false,
    });
    expect(first.coverUrl).toMatch(/^https:\/\/assets\.hardcover\.app\//);
  });

  it("keeps fractional positions (novellas) and flags the book-level compilation the series flag missed", () => {
    const s = normalizeSeriesBooks(witcherFixture.data.series[0])!;
    expect(s.entries.map((e) => e.position)).toEqual([0, 0.1, 0.2, 0.5, 0.7, 1, 2, 3, 4, 5]);
    const flagged = s.entries.filter((e) => e.isCompilation).map((e) => e.title);
    expect(flagged).toEqual(["La Dame du lac / La saison des orages"]);
    expect(s.entries.find((e) => e.title === "The Last Wish")?.isCompilation).toBe(false);
    expect(s.skipped).toBe(1); // "Something ends, something begins" has no position
  });

  it("returns null for a missing or nameless series", () => {
    expect(normalizeSeriesBooks(null)).toBeNull();
    expect(normalizeSeriesBooks({ id: 1 })).toBeNull();
  });

  it("drops a bad release date instead of failing", () => {
    const s = normalizeSeriesBooks({
      id: 5,
      name: "X",
      book_series: [{ position: 1, details: "1", compilation: false, book: { id: 9, title: "Y", release_date: "2030", contributions: [] } }],
    })!;
    expect(s.entries[0].releaseDate).toBeNull();
  });
});

describe("isCompilationEntry", () => {
  const base = { bookSeriesCompilation: false, bookCompilation: false, details: "1", title: "Plain" };
  it("trusts either Hardcover flag", () => {
    expect(isCompilationEntry({ ...base, bookSeriesCompilation: true })).toBe(true);
    expect(isCompilationEntry({ ...base, bookCompilation: true })).toBe(true);
  });
  it("treats a non-numeric details text as a range", () => {
    expect(isCompilationEntry({ ...base, details: "1-3" })).toBe(true);
    expect(isCompilationEntry({ ...base, details: "0, 5" })).toBe(true);
    expect(isCompilationEntry({ ...base, details: "2.5" })).toBe(false);
    expect(isCompilationEntry({ ...base, details: null })).toBe(false);
  });
  it("falls back to the title heuristic", () => {
    for (const title of ["The Hunger Games Box Set", "Foundation Omnibus", "The Complete Series", "Books 1-3", "3-Book Collection", "Lord of the Rings Trilogy"]) {
      expect(isCompilationEntry({ ...base, title }), title).toBe(true);
    }
    for (const title of ["Dune", "The Last Wish", "Collecting Ghosts", "Complete Madness"]) {
      expect(isCompilationEntry({ ...base, title }), title).toBe(false);
    }
  });
});

describe("series search", () => {
  const hits = normalizeSeriesSearch(searchFixture.data.search.results);

  it("reads hits", () => {
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.find((h) => h.hardcoverId === 1808)).toMatchObject({ name: "The Witcher", authorName: "Andrzej Sapkowski", primaryBooksCount: 5 });
  });

  it("picks the most-read series with the same name and author", () => {
    expect(pickSeriesHit(hits, { name: "The Witcher", author: "Andrzej Sapkowski" })?.hardcoverId).toBe(1808);
    expect(pickSeriesHit(hits, { name: "Witcher", author: "Sapkowski, Andrzej" })?.hardcoverId).toBe(1808);
  });

  it("rejects a different author or name", () => {
    expect(pickSeriesHit(hits, { name: "The Witcher", author: "Someone Else" })).toBeNull();
    expect(pickSeriesHit(hits, { name: "Dune", author: null })).toBeNull();
  });

  it("matches on name alone when the author is unknown", () => {
    expect(pickSeriesHit(hits, { name: "The Witcher", author: null })?.hardcoverId).toBe(1808);
  });
});
