import { beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.fn();
const revalidate = vi.fn();
const upsert = vi.fn();
const update = vi.fn();
const insert = vi.fn();
const updateIn = vi.fn();
let tables: Record<string, { data: unknown[] }>;

const LIB = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function select(table: string) {
  const q = { eq: () => q, in: () => q, then: (r: (v: unknown) => unknown) => r({ data: tables[table].data, error: null }) };
  return q;
}
const from = vi.fn((table: string) => ({
  select: () => select(table),
  upsert: (...a: unknown[]) => (upsert(table, ...a), Promise.resolve({ error: null })),
  update: (v: unknown) => (update(table, v), { in: (...a: unknown[]) => (updateIn(...a), Promise.resolve({ error: null })) }),
  insert: (rows: unknown) => (insert(table, rows), Promise.resolve({ error: null })),
}));

vi.mock("@/lib/library", () => ({ getLibraryContext: () => context() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidate(...a) }));

import { bulkSetCopyFields, bulkSetStatus } from "./bulk-actions";

const as = (role: string) => context.mockResolvedValue({ user: { id: "me" }, libraries: [{ id: LIB, role }] });

beforeEach(() => {
  vi.clearAllMocks();
  as("editor");
  tables = { books: { data: [] }, copies: { data: [] } };
});

describe("guard", () => {
  it("rejects ids that are not all in the library, and a library that is not the person's", async () => {
    tables.books.data = [{ id: id(1) }];
    expect(await bulkSetStatus({ libraryId: LIB, bookIds: [id(1), id(2)], status: "read" })).toMatchObject({ ok: false });
    expect(upsert).not.toHaveBeenCalled();
    expect(await bulkSetStatus({ libraryId: id(9), bookIds: [id(1)], status: "read" })).toEqual({ ok: false, error: "That library is not yours." });
  });
  it("rejects an empty list, more than 500 ids and bad values", async () => {
    expect((await bulkSetStatus({ libraryId: LIB, bookIds: [], status: "read" })).ok).toBe(false);
    expect((await bulkSetStatus({ libraryId: LIB, bookIds: Array.from({ length: 501 }, (_, i) => id(i)), status: "read" })).ok).toBe(false);
    expect((await bulkSetStatus({ libraryId: LIB, bookIds: [id(1)], status: "nope" as never })).ok).toBe(false);
  });
});

describe("bulkSetStatus", () => {
  it("lets a viewer set their status, writing only user, book and status", async () => {
    as("viewer");
    tables.books.data = [{ id: id(1) }, { id: id(2) }];
    expect(await bulkSetStatus({ libraryId: LIB, bookIds: [id(1), id(2)], status: "read" })).toEqual({ ok: true, updated: 2 });
    const [table, rows, opts] = upsert.mock.calls[0];
    expect(table).toBe("user_books");
    expect(rows).toEqual([
      { user_id: "me", book_id: id(1), status: "read" },
      { user_id: "me", book_id: id(2), status: "read" },
    ]);
    expect(rows.every((r: object) => !("rating" in r) && !("notes" in r))).toBe(true);
    expect(opts).toEqual({ onConflict: "user_id,book_id" });
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith("/library");
  });
});

describe("bulkSetCopyFields", () => {
  it("refuses a viewer and an empty change", async () => {
    tables.books.data = [{ id: id(1) }];
    as("viewer");
    expect(await bulkSetCopyFields({ libraryId: LIB, bookIds: [id(1)], format: "ebook" })).toEqual({ ok: false, error: "Only owners and editors can change the library." });
    as("editor");
    expect((await bulkSetCopyFields({ libraryId: LIB, bookIds: [id(1)] })).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("counts one copy, no copy (owned and wishlist) and several copies", async () => {
    tables.books.data = [
      { id: id(1), ownership: "owned", isbn13: "978" },
      { id: id(2), ownership: "owned", isbn13: "979" },
      { id: id(3), ownership: "owned", isbn13: null },
      { id: id(4), ownership: "wishlist", isbn13: null },
    ];
    tables.copies.data = [
      { id: "c1", book_id: id(1) },
      { id: "c3a", book_id: id(3) },
      { id: "c3b", book_id: id(3) },
    ];
    const res = await bulkSetCopyFields({ libraryId: LIB, bookIds: [id(1), id(2), id(3), id(4)], condition: "good" });
    expect(res).toEqual({ ok: true, updated: 1, created: 1, skippedMultiCopy: 1, skippedNoCopy: 1 });
    expect(update).toHaveBeenCalledWith("copies", { condition: "good" });
    expect(updateIn).toHaveBeenCalledWith("id", ["c1"]);
    expect(insert).toHaveBeenCalledWith("copies", [{ book_id: id(2), edition_isbn: "979", condition: "good" }]);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });
});
