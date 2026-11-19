import { describe, expect, it } from "vitest";
import type { LibraryItem } from "@/lib/books/library-query";
import { ROW_COVERS } from "./constants";
import { buildReadingGroups, idsByPosition, readingCoverIds, sortShelves, type ReadingRow } from "./content";
import type { Shelf } from "./types";

function item(over: Partial<LibraryItem> & { id: string; title: string }): LibraryItem {
  return { authors: [], seriesName: null, seriesPosition: null, coverUrl: null, ownership: "owned", publicRating: null, createdAt: "2026-01-01T00:00:00Z", formats: [], totalPaid: null, mine: null, others: [], loans: [], ...over };
}
const shelf = (over: Partial<Shelf>): Shelf => ({ id: "s", libraryId: "l", name: "S", color: "spine-1", icon: null, visibility: "shared", kind: "manual", rules: null, sort: "title", sortOrder: 1024, createdBy: "u", createdAt: "2026-01-01", ...over });

const refs = (...ids: [string, number][]) => ids.map(([bookId, position]) => ({ bookId, position }));

describe("idsByPosition", () => {
  it("follows the stored positions", () => expect(idsByPosition(refs(["a", 3072], ["b", 1024], ["c", 2048]))).toEqual(["b", "c", "a"]));
  it("breaks a tie on the id", () => expect(idsByPosition(refs(["b", 5], ["a", 5], ["c", 1]))).toEqual(["c", "a", "b"]));
});

const reading = (userId: string, bookId: string, createdAt: string): ReadingRow => ({ userId, bookId, createdAt });
const items = new Map([
  ["a", item({ id: "a", title: "Zebra" })],
  ["b", item({ id: "b", title: "Apple" })],
  ["c", item({ id: "c", title: "Mango" })],
]);

describe("currently reading", () => {
  const rows = [reading("me", "a", "2026-01-01"), reading("w", "b", "2026-01-02"), reading("w", "c", "2026-01-03")];
  it("groups by person, me first, with names, newest book first", () => {
    const g = buildReadingGroups(rows, items, new Map([["me", "Nic"], ["w", "Wife"]]), "me");
    expect(g.map((x) => [x.name, x.count, x.isMe])).toEqual([["Nic", 1, true], ["Wife", 2, false]]);
    expect(g[1].covers.map((c) => c.id)).toEqual(["c", "b"]);
  });
  it("leaves out people with nothing in progress", () => {
    expect(buildReadingGroups([], items, new Map(), "me")).toEqual([]);
  });
  it("counts every book but shows and asks for only the first 12 covers", () => {
    const many = Array.from({ length: 20 }, (_, i) => reading("me", `b${String(i).padStart(2, "0")}`, `2026-01-${String(i + 1).padStart(2, "0")}`));
    expect(readingCoverIds(many)).toHaveLength(ROW_COVERS);
    expect(readingCoverIds(many)[0]).toBe("b19");
    const byId = new Map(many.map((r) => [r.bookId, item({ id: r.bookId, title: r.bookId })]));
    const g = buildReadingGroups(many, byId, new Map(), "me");
    expect(g[0].count).toBe(20);
    expect(g[0].covers).toHaveLength(ROW_COVERS);
  });
});

describe("shelf row order", () => {
  it("sorts by sort_order, then age", () => {
    const l = [shelf({ id: "2", sortOrder: 2048 }), shelf({ id: "1", sortOrder: 1024 }), shelf({ id: "0", sortOrder: 1024, createdAt: "2025-01-01" })];
    expect(sortShelves(l).map((s) => s.id)).toEqual(["0", "1", "2"]);
  });
});
