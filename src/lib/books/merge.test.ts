import { describe, expect, it } from "vitest";
import { defaultCoverFrom, mergeErrorMessage, mergeSummary, parseMergeCounts, type MergeBook } from "./merge";

const b = (id: string, over: Partial<MergeBook> = {}): MergeBook => ({
  id, title: `Book ${id}`, authors: [], seriesName: null, seriesPosition: null, isbn13: null, publishedDate: null,
  coverUrl: null, copies: 1, readingRecords: 0, ...over,
});

describe("defaultCoverFrom", () => {
  it("prefers the kept book's cover", () => {
    expect(defaultCoverFrom([b("a", { coverUrl: "x" }), b("b", { coverUrl: "y" })], "b")).toBe("b");
  });
  it("falls back to the first book with a cover, or none", () => {
    expect(defaultCoverFrom([b("a"), b("b", { coverUrl: "y" }), b("c", { coverUrl: "z" })], "a")).toBe("b");
    expect(defaultCoverFrom([b("a"), b("b")], "a")).toBeNull();
  });
});

describe("mergeSummary", () => {
  it("counts what moves from the other books only", () => {
    const books = [b("a", { title: "Half-Blood", copies: 5 }), b("b", { copies: 2, readingRecords: 1 }), b("c", { copies: 1, readingRecords: 1 })];
    expect(mergeSummary(books, "a")).toBe("3 copies and 2 reading records move to Half-Blood. 2 entries are removed. This can't be undone.");
  });
  it("uses singular forms and skips empty parts", () => {
    expect(mergeSummary([b("a", { title: "T" }), b("b", { copies: 1 })], "a")).toBe("1 copy moves to T. 1 entry is removed. This can't be undone.");
    expect(mergeSummary([b("a", { title: "T" }), b("b", { copies: 0 })], "a")).toBe("1 entry is removed. This can't be undone.");
  });
});

describe("parseMergeCounts / mergeErrorMessage", () => {
  it("reads the rpc payload", () => {
    expect(parseMergeCounts({ copies: 2, reads: 1, loans: 0, shelves: 3, reading_records: 4, removed: 2 })).toEqual({ copies: 2, reads: 1, loans: 0, shelves: 3, readingRecords: 4, removed: 2 });
    expect(parseMergeCounts(null)).toBeNull();
  });
  it("shows known database messages and hides the rest", () => {
    expect(mergeErrorMessage("More than one of these books is on loan from someone right now. Return all but one first, then merge.")).toMatch(/on loan/);
    expect(mergeErrorMessage('duplicate key value violates unique constraint "x"')).toBe("Could not merge those books.");
  });
});
