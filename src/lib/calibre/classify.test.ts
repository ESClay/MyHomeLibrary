import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findDuplicates, type ExistingBook } from "@/lib/duplicates";
import { buildLibraryLookup, classifyRows, countRows, effectiveAction, includeAction, matchRow, type LibraryIndexBook } from "./classify";
import { parseCalibreCsv } from "./parse";
import type { ImportAction } from "./types";

const fixture = readFileSync(fileURLToPath(new URL("./__fixtures__/calibre-catalog.csv", import.meta.url)), "utf8");
const parse = () => parseCalibreCsv(fixture, { yieldFn: async () => {} });

const lib = (over: Partial<LibraryIndexBook> & { id: string; title: string }): LibraryIndexBook => ({
  authors: [],
  isbn13: null,
  calibreUuid: null,
  copyIsbns: [],
  ...over,
});

describe("classifyRows", () => {
  it("an empty library: everything usable is new, the broken rows need attention", async () => {
    const { rows } = await parse();
    const c = classifyRows(rows, []);
    expect(c.map((x) => x.status)).toEqual(["new", "new", "new", "new", "new", "attention", "attention", "new", "new"]);
    expect(c[5]).toMatchObject({ reason: "This row has no title.", allowed: ["skip"], defaultAction: "skip" });
    // The repeated uuid row is an error, so it can never be added.
    expect(c[6]).toMatchObject({ reason: "Repeats the Calibre id of row 1.", allowed: ["skip"] });
    expect(c[0]).toMatchObject({ defaultAction: "add", allowed: ["skip", "add"] });
  });

  it("matches an existing book by ISBN (book or a copy's edition ISBN) and defaults to adding an e-book copy", async () => {
    const { rows } = await parse();
    const c = classifyRows(rows, [
      lib({ id: "b1", title: "Fellowship", isbn13: "9780261102354" }),
      lib({ id: "b2", title: "Some other title", copyIsbns: ["9780441172719"] }),
    ]);
    expect(c[0]).toMatchObject({ status: "existing", matchedBy: "isbn", match: { id: "b1" }, defaultAction: "copy", allowed: ["skip", "copy", "add"] });
    expect(c[3]).toMatchObject({ status: "existing", matchedBy: "isbn", match: { id: "b2" } });
  });

  it("falls back to normalized title plus first author when there is no ISBN match", async () => {
    const { rows } = await parse();
    const c = classifyRows(rows, [lib({ id: "t1", title: "The Hobbit!", authors: ["Tolkien, J. R. R."] })]);
    expect(c[4]).toMatchObject({ status: "existing", matchedBy: "title", defaultAction: "copy" });
    expect(c[0].status).toBe("new"); // same author, different title
  });

  it("a book already imported (same calibre uuid) defaults to skip and only allows an e-book copy as an override", async () => {
    const { rows } = await parse();
    const c = classifyRows(rows, [lib({ id: "u1", title: "Renamed since", calibreUuid: "0a1b2c3d-0000-4000-8000-000000000002" })]);
    expect(c[1]).toMatchObject({ status: "existing", matchedBy: "uuid", defaultAction: "skip", allowed: ["skip", "copy"], reason: "Already imported from this Calibre library." });
    expect(effectiveAction(c[1], undefined)).toBe("skip");
    expect(effectiveAction(c[1], "copy")).toBe("copy");
    expect(effectiveAction(c[1], "add")).toBe("skip"); // not allowed, falls back to the default
  });

  it("uuid beats isbn and title", async () => {
    const { rows } = await parse();
    const c = classifyRows(rows, [
      lib({ id: "isbn", title: "x", isbn13: "9780261102354" }),
      lib({ id: "uuid", title: "y", calibreUuid: "0a1b2c3d-0000-4000-8000-000000000001" }),
    ]);
    expect(c[0].match?.id).toBe("uuid");
    expect(c[0].matchedBy).toBe("uuid");
  });

  it("flags a repeat inside the file by ISBN or by title and author, defaulting to skip", () => {
    const rows = [
      { n: 1, title: "Alpha", authors: ["Ann Lee"], isbn13: "9780261102354", calibreUuid: "u1", error: null },
      { n: 2, title: "Alpha (again)", authors: ["Ann Lee"], isbn13: "9780261102354", calibreUuid: "u2", error: null },
      { n: 3, title: "The Alpha", authors: ["Ann Lee"], isbn13: null, calibreUuid: "u3", error: null },
      { n: 4, title: "Beta", authors: ["Ann Lee"], isbn13: null, calibreUuid: "u4", error: null },
    ].map((r) => ({ ...r, series: null, seriesPosition: null, identifiers: {}, description: null, publishedDate: null, publisher: null, languages: [], formats: [], custom: {}, notes: [] }));
    const c = classifyRows(rows, []);
    expect(c.map((x) => x.status)).toEqual(["new", "attention", "attention", "new"]);
    expect(c[1]).toMatchObject({ repeatOf: 1, defaultAction: "skip", allowed: ["skip", "add"] });
    expect(c[2].repeatOf).toBe(1);
  });

  it("includeAction is each row's natural way in", async () => {
    const { rows } = await parse();
    const c = classifyRows(rows, [
      lib({ id: "b1", title: "x", isbn13: "9780261102354" }),
      lib({ id: "u1", title: "z", calibreUuid: "0a1b2c3d-0000-4000-8000-000000000002" }),
    ]);
    expect(c.map(includeAction)).toEqual(["skip", "skip", "add", "add", "add", "skip", "skip", "add", "add"].map((v, i) => (i === 0 ? "copy" : v)));
  });

  it("countRows applies overrides", async () => {
    const { rows } = await parse();
    const c = classifyRows(rows, [lib({ id: "b1", title: "x", isbn13: "9780261102354" })]);
    const overrides = new Map<number, ImportAction>([[2, "skip"]]);
    expect(countRows(c, overrides)).toEqual({ total: 9, new: 6, existing: 1, attention: 2, toAdd: 5, toCopy: 1, skipped: 3 });
  });
});

describe("the indexed matcher agrees with the Phase 2 matcher (findDuplicates)", () => {
  const books: LibraryIndexBook[] = [
    lib({ id: "1", title: "The Great Gatsby", authors: ["F. Scott Fitzgerald"], isbn13: "9780743273565" }),
    lib({ id: "2", title: "Dune", authors: ["Frank Herbert"], copyIsbns: ["9780441172719"] }),
    lib({ id: "3", title: "Émile", authors: ["Rousseau, Jean-Jacques"] }),
  ];
  const existing: ExistingBook[] = books.map((b) => ({ id: b.id, title: b.title, authors: b.authors, isbn13: b.isbn13, copyIsbns: b.copyIsbns }));
  const lookup = buildLibraryLookup(books);

  const cases = [
    { title: "Great Gatsby", authors: ["Fitzgerald"], isbn13: null },
    { title: "Whatever", authors: [], isbn13: "9780441172719" },
    { title: "Emile", authors: ["Jean-Jacques Rousseau"], isbn13: null },
    { title: "Dune Messiah", authors: ["Frank Herbert"], isbn13: null },
    { title: "Nothing like it", authors: ["Nobody"], isbn13: "9780261102354" },
  ];

  it.each(cases)("same answer for %j", (c) => {
    const slow = findDuplicates(c, existing)[0]?.book.id ?? null;
    const fast = matchRow({ ...c, calibreUuid: null }, lookup)?.book.id ?? null;
    expect(fast).toBe(slow);
  });
});
