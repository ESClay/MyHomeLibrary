import { beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.fn();
const revalidate = vi.fn();
const rpc = vi.fn();
let tables: Record<string, { data: unknown[] }>;

const LIB = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function select(table: string) {
  const q = {
    eq: () => q,
    in: () => q,
    maybeSingle: () => Promise.resolve({ data: tables[table].data[0] ?? null, error: null }),
    then: (r: (v: unknown) => unknown) => r({ data: tables[table].data, error: null }),
  };
  return q;
}
const from = vi.fn((table: string) => ({ select: () => select(table) }));

vi.mock("@/lib/library", () => ({ getLibraryContext: () => context() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from, rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidate(...a) }));

import { loadMergeBooks, mergeBooks } from "./bulk-actions";

const as = (role: string) => context.mockResolvedValue({ user: { id: "me" }, libraries: [{ id: LIB, role }] });
const input = { libraryId: LIB, keepId: id(1), mergeIds: [id(2), id(3)] };
const rpcCounts = { copies: 2, reads: 0, loans: 0, shelves: 1, reading_records: 2, removed: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  as("editor");
  tables = { books: { data: [{ id: id(1) }, { id: id(2) }, { id: id(3) }] } };
  rpc.mockResolvedValue({ data: rpcCounts, error: null });
});

describe("mergeBooks", () => {
  it("calls merge_books and returns the counts and a message", async () => {
    const res = await mergeBooks({ ...input, coverFromId: id(2) });
    expect(res).toMatchObject({ ok: true, counts: { copies: 2, shelves: 1, readingRecords: 2, removed: 2 } });
    expect(rpc).toHaveBeenCalledWith("merge_books", { p_keep: id(1), p_merge: [id(2), id(3)], p_cover_from: id(2) });
    expect(revalidate).toHaveBeenCalledWith("/library");
  });
  it("refuses a viewer and a library that is not the person's, without calling the database", async () => {
    as("viewer");
    expect(await mergeBooks(input)).toEqual({ ok: false, error: "Only owners and editors can merge books." });
    as("editor");
    expect(await mergeBooks({ ...input, libraryId: id(9) })).toEqual({ ok: false, error: "That library is not yours." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("validates the selection", async () => {
    expect((await mergeBooks({ ...input, mergeIds: [] })).ok).toBe(false);
    expect((await mergeBooks({ ...input, mergeIds: Array.from({ length: 10 }, (_, i) => id(10 + i)) })).ok).toBe(false);
    expect((await mergeBooks({ ...input, mergeIds: [id(1)] })).ok).toBe(false);
    expect((await mergeBooks({ ...input, mergeIds: [id(2), id(2)] })).ok).toBe(false);
    expect((await mergeBooks({ ...input, coverFromId: id(7) })).ok).toBe(false);
    expect((await mergeBooks({ ...input, keepId: "nope" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses books that are not all in the library", async () => {
    tables.books.data = [{ id: id(1) }];
    expect(await mergeBooks(input)).toEqual({ ok: false, error: "Some of those books are not in this library." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database's plain message, hides anything else", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "More than one of these books is on loan from someone right now. Return all but one first, then merge." } });
    expect(await mergeBooks(input)).toMatchObject({ ok: false, error: expect.stringContaining("on loan") });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "relation boom" } });
    expect(await mergeBooks(input)).toEqual({ ok: false, error: "Could not merge those books." });
    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe("loadMergeBooks", () => {
  it("refuses a viewer and a selection outside 2 to 10", async () => {
    as("viewer");
    expect((await loadMergeBooks({ libraryId: LIB, bookIds: [id(1), id(2)] })).ok).toBe(false);
    as("editor");
    expect((await loadMergeBooks({ libraryId: LIB, bookIds: [id(1)] })).ok).toBe(false);
  });
  it("returns each book with its copy and reading-record counts, in the order given", async () => {
    tables = {
      books: { data: [
        { id: id(2), title: "B", authors: ["Y"], series_name: null, series_position: null, isbn13: "978", published_date: "2020-05-01", cover_url: null },
        { id: id(1), title: "A", authors: ["X"], series_name: "S", series_position: 2, isbn13: null, published_date: null, cover_url: "https://c/a.jpg" },
      ] },
      copies: { data: [{ book_id: id(1) }, { book_id: id(1) }, { book_id: id(2) }] },
      user_books: { data: [{ book_id: id(1) }] },
      reads: { data: [{ book_id: id(1) }, { book_id: id(2) }] },
    };
    const res = await loadMergeBooks({ libraryId: LIB, bookIds: [id(1), id(2)] });
    expect(res.ok && res.books.map((b) => [b.id, b.copies, b.readingRecords])).toEqual([[id(1), 2, 2], [id(2), 1, 1]]);
  });
});
