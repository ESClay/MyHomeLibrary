import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/supabase-fake";
import type { LibraryItem } from "@/lib/books/library-query";

let db: ReturnType<typeof fakeSupabase>;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
const pageIds = vi.fn();
const byIds = vi.fn();
vi.mock("@/lib/books/data", () => ({
  loadLibraryPageIds: (...a: unknown[]) => pageIds(...a),
  loadLibraryItemsByIds: (...a: unknown[]) => byIds(...a),
  loadLibraryPageItems: vi.fn(),
  countLibraryBooks: async () => 1500,
}));

import { loadShelfDetail, loadShelvesOverview } from "./data";

const item = (id: string): LibraryItem => ({ id, title: `T${id}`, authors: [], seriesName: null, seriesPosition: null, coverUrl: null, ownership: "owned", publicRating: null, createdAt: "2026-01-01", formats: [], totalPaid: null, mine: null, others: [], loans: [] });
const shelfRow = (id: string, over: Record<string, unknown>) => ({ id, library_id: "lib", name: id, color: "spine-1", icon: null, visibility: "shared", kind: "manual", rules: null, sort: "custom", sort_order: 1, created_by: "u", created_at: `2026-01-0${id.length}`, ...over });

beforeEach(() => {
  pageIds.mockReset().mockResolvedValue({ ids: [], total: 0 });
  byIds.mockReset().mockImplementation(async (ids: string[]) => ids.map(item));
});

describe("loadShelvesOverview", () => {
  it("asks only for each shelf's covers and count, never the whole library", async () => {
    db = fakeSupabase({
      shelves: [
        shelfRow("m", { kind: "manual", sort: "custom", sort_order: 1 }),
        shelfRow("mt", { kind: "manual", sort: "title", sort_order: 2 }),
        shelfRow("s", { kind: "smart", rules: { own: "owned" }, sort: "title", sort_order: 3 }),
      ],
      library_members: [],
      user_books: [{ user_id: "me", book_id: "r1", status: "reading", "books.library_id": "lib", books: { created_at: "2026-01-02" } }],
      shelf_books: [
        { shelf_id: "m", book_id: "b2", position: 2048 },
        { shelf_id: "m", book_id: "b1", position: 1024 },
        { shelf_id: "mt", book_id: "b3", position: 1024 },
      ],
    });
    pageIds.mockImplementation(async (_lib: string, _p: unknown, opts: { bookIds?: string[] }) => (opts.bookIds ? { ids: ["b3"], total: 1 } : { ids: ["s1", "s2"], total: 700 }));

    const res = await loadShelvesOverview("lib", "me");

    expect(res.bookCount).toBe(1500);
    expect(res.rows.map((r) => [r.shelf.id, r.count, r.covers.map((c) => c.id)])).toEqual([
      ["m", 2, ["b1", "b2"]],
      ["mt", 1, ["b3"]],
      ["s", 700, ["s1", "s2"]],
    ]);
    // Smart shelf: the first 12 only. Title-sorted manual shelf: its own ids only. Custom manual shelf: no library query at all.
    expect(pageIds).toHaveBeenCalledTimes(2);
    expect(pageIds).toHaveBeenCalledWith("lib", expect.objectContaining({ own: "owned", sort: "title" }), { limit: 12 });
    expect(pageIds).toHaveBeenCalledWith("lib", expect.objectContaining({ sort: "title" }), expect.objectContaining({ bookIds: ["b3"], limit: 12 }));
    // One details query, for the covers shown plus the reading shelf's.
    expect(byIds).toHaveBeenCalledTimes(1);
    expect([...byIds.mock.calls[0][0]].sort()).toEqual(["b1", "b2", "b3", "r1", "s1", "s2"]);
    expect(res.reading[0]).toMatchObject({ isMe: true, count: 1 });
  });
});

describe("loadShelfDetail", () => {
  it("loads all of a manual shelf's books, in its own order, and nothing else", async () => {
    db = fakeSupabase({ shelf_books: [{ shelf_id: "m", book_id: "b2", position: 2 }, { shelf_id: "m", book_id: "b1", position: 1 }] });
    const shelf = { id: "m", libraryId: "lib", kind: "manual", sort: "custom", rules: null } as never;
    const res = await loadShelfDetail(shelf, "me");
    expect(res.books.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(res).toMatchObject({ total: 2, hasMore: false });
    expect(pageIds).not.toHaveBeenCalled();
  });
});
