import { describe, expect, it } from "vitest";
import { computeGaps, isVolume, type GapBook, type GapEntry, type GapSeries } from "./gaps";
import { buildLibraryIndex, cleanTitle, inLibrary, workKey } from "./match";

const NOW = new Date("2026-11-15T12:00:00Z");

let n = 0;
function entry(over: Partial<GapEntry> & { title: string; position: number | null }): GapEntry {
  n++;
  return {
    id: `e${n}`,
    authors: ["Frank Herbert"],
    hardcoverBookId: 1000 + n,
    isbn13: null,
    coverUrl: null,
    releaseDate: "1970-01-01",
    isCompilation: false,
    ...over,
  };
}

function book(over: Partial<GapBook> & { title: string }): GapBook {
  return { authors: ["Frank Herbert"], isbn13: null, copyIsbns: [], hardcoverId: null, seriesId: "s1", ...over };
}

const dune = (entries: GapEntry[]): GapSeries => ({ id: "s1", name: "Dune", hardcoverId: 1150, syncedAt: "2026-11-01T00:00:00Z", entries });

describe("matching", () => {
  it("cleans series suffixes and keys by title and surname", () => {
    expect(cleanTitle("Dune (Dune, #1)")).toBe("Dune");
    expect(workKey("The Hobbit", ["J. R. R. Tolkien"])).toBe(workKey("Hobbit (Illustrated)", ["Tolkien, J.R.R."]));
  });

  it("matches by hardcover id, ISBN (book or copy) and title+author, and not by a different author", () => {
    const idx = buildLibraryIndex([
      { title: "Dune", authors: ["Frank Herbert"], isbn13: "9780441172719", copyIsbns: [], hardcoverId: 312460 },
      { title: "Emma", authors: ["Jane Austen"], isbn13: null, copyIsbns: ["9780141439587"], hardcoverId: null },
    ]);
    expect(inLibrary(idx, { title: "x", authors: [], isbn13s: [], hardcoverId: 312460 })).toBe(true);
    expect(inLibrary(idx, { title: "x", authors: [], isbn13s: ["9780441172719"], hardcoverId: null })).toBe(true);
    expect(inLibrary(idx, { title: "x", authors: [], isbn13s: ["9780141439587"], hardcoverId: null })).toBe(true);
    expect(inLibrary(idx, { title: "emma", authors: ["Austen, Jane"], isbn13s: [], hardcoverId: null })).toBe(true);
    expect(inLibrary(idx, { title: "Emma", authors: ["Someone Else"], isbn13s: [], hardcoverId: null })).toBe(false);
    expect(inLibrary(idx, { title: "Emma", authors: [], isbn13s: [], hardcoverId: null })).toBe(false);
  });

  it("matches any listed author, in any order", () => {
    const idx = buildLibraryIndex([{ title: "Good Omens", authors: ["Neil Gaiman", "Terry Pratchett"], isbn13: null, copyIsbns: [], hardcoverId: null }]);
    expect(inLibrary(idx, { title: "Good Omens", authors: ["Terry Pratchett"], isbn13s: [], hardcoverId: null })).toBe(true);
  });

  it("matches an author-less library book by title alone", () => {
    const idx = buildLibraryIndex([{ title: "Mystery Book", authors: [], isbn13: null, copyIsbns: [], hardcoverId: null }]);
    expect(inLibrary(idx, { title: "Mystery Book", authors: ["Anyone"], isbn13s: [], hardcoverId: null })).toBe(true);
  });
});

describe("isVolume", () => {
  it("excludes future releases, compilations and unnumbered entries but keeps novellas", () => {
    expect(isVolume(entry({ title: "Future", position: 7, releaseDate: "2027-01-01" }), "2026-11-15")).toBe(false);
    expect(isVolume(entry({ title: "Today", position: 7, releaseDate: "2026-11-15" }), "2026-11-15")).toBe(true);
    expect(isVolume(entry({ title: "Box", position: 1, isCompilation: true }), "2026-11-15")).toBe(false);
    expect(isVolume(entry({ title: "Loose", position: null }), "2026-11-15")).toBe(false);
    expect(isVolume(entry({ title: "Novella", position: 2.5 }), "2026-11-15")).toBe(true);
    expect(isVolume(entry({ title: "Undated", position: 3, releaseDate: null }), "2026-11-15")).toBe(true);
  });
});

describe("computeGaps", () => {
  const entries = [
    entry({ title: "Chapterhouse: Dune", position: 6, hardcoverBookId: 6 }),
    entry({ title: "Dune", position: 1, hardcoverBookId: 1, isbn13: "9780441172719" }),
    entry({ title: "Dune Messiah", position: 2, hardcoverBookId: 2 }),
    entry({ title: "Dune Novella", position: 2.5, hardcoverBookId: 25 }),
    entry({ title: "Children of Dune", position: 3, hardcoverBookId: 3 }),
    entry({ title: "Dune Omnibus", position: 1, isCompilation: true, hardcoverBookId: 99 }),
    entry({ title: "Dune 7", position: 7, releaseDate: "2030-05-01", hardcoverBookId: 7 }),
  ];

  it("lists what is missing in position order, with novellas, without future or compilation entries", () => {
    const [gap] = computeGaps({
      now: NOW,
      books: [book({ title: "Dune", isbn13: "9780441172719" }), book({ title: "Children of Dune", hardcoverId: 3 })],
      series: [dune(entries)],
    });
    expect(gap.missing.map((e) => e.title)).toEqual(["Dune Messiah", "Dune Novella", "Chapterhouse: Dune"]);
    expect(gap.owned).toBe(2);
    expect(gap.total).toBe(5);
    expect(gap.volumes.map((v) => v.entry.position)).toEqual([1, 2, 2.5, 3, 6]);
    expect(gap.volumes.find((v) => v.entry.position === 1)?.have).toBe(true);
    expect(gap.pending).toBe(false);
  });

  it("counts a wishlist-title match by title and author", () => {
    const [gap] = computeGaps({ now: NOW, books: [book({ title: "dune messiah" })], series: [dune(entries)] });
    expect(gap.volumes.find((v) => v.entry.title === "Dune Messiah")?.have).toBe(true);
  });

  it("ignores series no library book is linked to, and orders series by how much is owned", () => {
    const other: GapSeries = {
      id: "s2",
      name: "Another",
      hardcoverId: 2,
      syncedAt: null,
      entries: [entry({ title: "A1", position: 1, authors: ["X Y"] })],
    };
    const unlinked: GapSeries = { id: "s3", name: "Unlinked", hardcoverId: 3, syncedAt: null, entries: [entry({ title: "U1", position: 1 })] };
    const gaps = computeGaps({
      now: NOW,
      books: [book({ title: "Dune" }), book({ title: "Dune Messiah" }), book({ title: "A1", authors: ["X Y"], seriesId: "s2" })],
      series: [other, unlinked, dune(entries)],
    });
    expect(gaps.map((g) => g.series.name)).toEqual(["Dune", "Another"]);
    expect(gaps[1].pending).toBe(true);
  });

  it("reports a complete series with nothing missing", () => {
    const [gap] = computeGaps({
      now: NOW,
      books: [book({ title: "Only" })],
      series: [dune([entry({ title: "Only", position: 1 })])],
    });
    expect(gap.missing).toEqual([]);
    expect(gap.owned).toBe(1);
  });
});
