import { describe, expect, it } from "vitest";
import type { LibraryItem } from "@/lib/books/library-query";
import { buildReadingGroups, buildShelfRows, orderManual, sortShelves } from "./content";
import type { Shelf } from "./types";

function item(over: Partial<LibraryItem> & { id: string; title: string }): LibraryItem {
  return { authors: [], seriesName: null, seriesPosition: null, coverUrl: null, ownership: "owned", publicRating: null, createdAt: "2026-01-01T00:00:00Z", formats: [], totalPaid: null, mine: null, others: [], ...over };
}
const shelf = (over: Partial<Shelf>): Shelf => ({ id: "s", libraryId: "l", name: "S", color: "spine-1", icon: null, visibility: "shared", kind: "manual", rules: null, sort: "title", sortOrder: 1024, createdBy: "u", createdAt: "2026-01-01", ...over });

const items = [
  item({ id: "a", title: "Zebra", publicRating: 3, mine: { status: "reading", rating: 4 }, authors: ["Zed Last"] }),
  item({ id: "b", title: "Apple", publicRating: 5, mine: { status: "read", rating: null }, others: [{ userId: "w", status: "reading" }], seriesName: "Fruit", seriesPosition: 2 }),
  item({ id: "c", title: "Mango", publicRating: 4, seriesName: "Fruit", seriesPosition: 1, others: [{ userId: "w", status: "reading" }] }),
];
const refs = (...ids: [string, number][]) => ids.map(([bookId, position]) => ({ bookId, position }));

describe("shelf sorting", () => {
  const r = refs(["a", 3072], ["b", 1024], ["c", 2048]);
  it("custom follows positions", () => expect(orderManual(items, r, "custom").map((i) => i.id)).toEqual(["b", "c", "a"]));
  it("title sorts alphabetically", () => expect(orderManual(items, r, "title").map((i) => i.id)).toEqual(["b", "c", "a"]));
  it("series keeps a series in order", () => expect(orderManual(items, r, "series").map((i) => i.id)).toEqual(["c", "b", "a"]));
  it("public rating is best first, my rating puts unrated last", () => {
    expect(orderManual(items, r, "public_rating").map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(orderManual(items, r, "my_rating").map((i) => i.id)[0]).toBe("a");
  });
  it("skips memberships whose book is gone", () => expect(orderManual(items, refs(["zz", 1], ["a", 2]), "custom").map((i) => i.id)).toEqual(["a"]));
});

describe("buildShelfRows", () => {
  it("counts everything but shows only the first 12 covers, in one pass", () => {
    const many = Array.from({ length: 20 }, (_, i) => item({ id: `b${String(i).padStart(2, "0")}`, title: `Book ${i}` }));
    const rows = buildShelfRows(
      [shelf({ id: "m", sort: "custom" }), shelf({ id: "s", kind: "smart", rules: { own: "owned" }, sort: "title" })],
      many,
      many.map((b, i) => ({ shelfId: "m", bookId: b.id, position: (i + 1) * 1024 })),
    );
    expect(rows[0].count).toBe(20);
    expect(rows[0].covers).toHaveLength(12);
    expect(rows[1].count).toBe(20);
    expect(rows[1].covers).toHaveLength(12);
  });
});

describe("currently reading", () => {
  it("groups by person, me first, with names", () => {
    const g = buildReadingGroups(items, new Map([["me", "Nic"], ["w", "Wife"]]), "me");
    expect(g.map((x) => [x.name, x.count, x.isMe])).toEqual([["Nic", 1, true], ["Wife", 2, false]]);
  });
  it("leaves out people with nothing in progress", () => {
    expect(buildReadingGroups([item({ id: "x", title: "X" })], new Map(), "me")).toEqual([]);
  });
});

describe("shelf row order", () => {
  it("sorts by sort_order, then age", () => {
    const l = [shelf({ id: "2", sortOrder: 2048 }), shelf({ id: "1", sortOrder: 1024 }), shelf({ id: "0", sortOrder: 1024, createdAt: "2025-01-01" })];
    expect(sortShelves(l).map((s) => s.id)).toEqual(["0", "1", "2"]);
  });
});
