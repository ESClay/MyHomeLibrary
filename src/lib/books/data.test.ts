import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/supabase-fake";
import { parseLibraryParams } from "./library-query";

let db: ReturnType<typeof fakeSupabase>;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

import { countLibraryBooks, loadLibraryItemsByIds, loadLibraryPageIds, loadLibraryPageItems, loadSeriesNames } from "./data";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `T${id}`,
  authors: ["A"],
  series_name: null,
  series_position: null,
  cover_url: null,
  ownership: "owned",
  public_rating: null,
  created_at: "2026-01-01T00:00:00Z",
  copies: [],
  user_books: [],
  loans: [],
  ...over,
});

describe("loadLibraryPageIds", () => {
  it("sends the params to library_page, with the query folded into terms, and reads the total off the first row", async () => {
    db = fakeSupabase({}, () => [
      { book_id: "b2", total: "7" },
      { book_id: "b1", total: "7" },
    ]);
    const params = parseLibraryParams({ q: "ÉCLAIR  Études", my: "none", rating: "3.5", sort: "title", dir: "desc", loan: "overdue" });
    const res = await loadLibraryPageIds("lib", params, { offset: 48, limit: 12, bookIds: ["b1"] });
    expect(res).toEqual({ ids: ["b2", "b1"], total: 7 });
    expect(db.rpc).toHaveBeenCalledWith("library_page", {
      p_library_id: "lib",
      p_terms: ["eclair", "etudes"],
      p_my: "none",
      p_partner: null,
      p_format: null,
      p_own: null,
      p_series: null,
      p_loan: "overdue",
      p_rating: "3.5",
      p_sort: "title",
      p_dir: "desc",
      p_offset: 48,
      p_limit: 12,
      p_book_ids: ["b1"],
    });
  });

  it("defaults to the first page and an empty result has a total of 0", async () => {
    db = fakeSupabase({}, () => []);
    expect(await loadLibraryPageIds("lib", parseLibraryParams({}))).toEqual({ ids: [], total: 0 });
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_terms: null, p_offset: 0, p_limit: 48, p_book_ids: null, p_rating: null });
  });

  it("throws when the database does", async () => {
    db = fakeSupabase({});
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);
    await expect(loadLibraryPageIds("lib", parseLibraryParams({}))).rejects.toThrow("boom");
  });
});

describe("loadLibraryItemsByIds", () => {
  beforeEach(() => {
    db = fakeSupabase({
      books: [
        row("a", { copies: [{ format: "ebook", purchase_price: null }, { format: "hardcover", purchase_price: 10 }], user_books: [{ user_id: "me", status: "read", rating: 4 }, { user_id: "w", status: "reading", rating: null }] }),
        row("b"),
        row("c"),
      ],
    });
  });

  it("returns the books in the order asked, skipping ones it cannot see", async () => {
    const items = await loadLibraryItemsByIds(["c", "zz", "a"], "me");
    expect(items.map((i) => i.id)).toEqual(["c", "a"]);
  });

  it("builds the person's view of a book", async () => {
    const [a] = await loadLibraryItemsByIds(["a"], "me");
    expect(a).toMatchObject({ formats: ["ebook", "hardcover"], totalPaid: 10, mine: { status: "read", rating: 4 }, others: [{ userId: "w", status: "reading" }] });
  });

  it("reads nothing for no ids, and reads long lists in chunks", async () => {
    expect(await loadLibraryItemsByIds([], "me")).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
    const ids = Array.from({ length: 250 }, (_, i) => `x${i}`);
    await loadLibraryItemsByIds(ids, "me");
    expect(db.from).toHaveBeenCalledTimes(3);
  });
});

describe("loadLibraryPageItems", () => {
  it("is ids from the database, then details for exactly those books", async () => {
    db = fakeSupabase({ books: [row("a"), row("b"), row("c")] }, () => [
      { book_id: "b", total: 3 },
      { book_id: "a", total: 3 },
    ]);
    const res = await loadLibraryPageItems("lib", "me", parseLibraryParams({}));
    expect(res.total).toBe(3);
    expect(res.items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(db.calls.filter((c) => c.table === "books")).toHaveLength(1);
  });
});

describe("counts and series names", () => {
  it("counts books with a head query", async () => {
    const builder = { select: vi.fn(), eq: vi.fn() };
    builder.select.mockReturnValue(builder);
    builder.eq.mockResolvedValue({ count: 1234, error: null });
    db = { from: vi.fn(() => builder) } as never;
    expect(await countLibraryBooks("lib")).toBe(1234);
    expect(builder.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
  });

  it("sorts the series names the way the filter lists them", async () => {
    db = fakeSupabase({}, () => ["beta", "Alpha", "Éclair"]);
    expect(await loadSeriesNames("lib")).toEqual(["Alpha", "beta", "Éclair"]);
  });
});
