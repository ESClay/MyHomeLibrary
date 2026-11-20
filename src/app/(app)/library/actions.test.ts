import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_SIZE, parseLibraryParams, type LibraryItem } from "@/lib/books/library-query";

const context = vi.fn();
const load = vi.fn();
const update = vi.fn();
const eq = vi.fn();
const from = vi.fn();
const rpc = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/library", () => ({ getLibraryContext: () => context(), requireUser: async () => ({ id: "me" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from, rpc }) }));
vi.mock("@/lib/books/data", () => ({ loadLibraryPageItems: (...a: unknown[]) => load(...a) }));

import { loadLibraryPage, renameAuthor, renameSeries, saveLibrarySort } from "./actions";

const item = (n: number): LibraryItem => ({
  id: String(n).padStart(3, "0"),
  title: `Book ${String(n).padStart(3, "0")}`,
  authors: ["A"],
  seriesName: null,
  seriesPosition: null,
  coverUrl: null,
  ownership: "owned",
  publicRating: null,
  createdAt: "2026-01-01",
  formats: [],
  totalPaid: null,
  mine: null,
  others: [],
  loans: [],
});
const TOTAL = PAGE_SIZE * 2 + 5;
const params = parseLibraryParams({ sort: "title", q: "book" });

beforeEach(() => {
  eq.mockReset().mockResolvedValue({ error: null });
  update.mockReset().mockReturnValue({ eq });
  from.mockReset().mockReturnValue({ update });
  context.mockResolvedValue({ user: { id: "me" }, libraries: [{ id: "lib-1" }] });
  load.mockReset().mockImplementation(async (_lib: string, _user: string, _p: unknown, opts: { offset: number; limit: number }) => ({
    items: Array.from({ length: Math.max(0, Math.min(opts.limit, TOTAL - opts.offset)) }, (_, i) => item(opts.offset + i + 1)),
    total: TOTAL,
  }));
});

describe("loadLibraryPage", () => {
  it("asks the database for the page at the offset and reports whether more remain", async () => {
    const first = await loadLibraryPage({ libraryId: "lib-1", params, offset: PAGE_SIZE });
    expect(first).toMatchObject({ ok: true, hasMore: true, total: TOTAL });
    expect(first.ok && first.items[0].id).toBe(String(PAGE_SIZE + 1).padStart(3, "0"));
    expect(load).toHaveBeenCalledWith("lib-1", "me", params, { offset: PAGE_SIZE, limit: PAGE_SIZE });
    const last = await loadLibraryPage({ libraryId: "lib-1", params, offset: PAGE_SIZE * 2 });
    expect(last.ok && last.items).toHaveLength(5);
    expect(last).toMatchObject({ ok: true, hasMore: false });
  });

  it("re-parses the params, so a tampered value falls back to a default", async () => {
    await loadLibraryPage({ libraryId: "lib-1", params: { ...params, sort: "nope" as never }, offset: 0 });
    expect(load.mock.calls[0][2]).toMatchObject({ sort: "author" });
  });

  it("refuses a library the person does not belong to, without reading anything", async () => {
    const res = await loadLibraryPage({ libraryId: "someone-elses", params, offset: 0 });
    expect(res).toEqual({ ok: false, error: "That library is not yours." });
    expect(load).not.toHaveBeenCalled();
  });

  it("treats a bad offset as the start and reports failures", async () => {
    await loadLibraryPage({ libraryId: "lib-1", params, offset: -5 });
    expect(load.mock.calls[0][3]).toEqual({ offset: 0, limit: PAGE_SIZE });
    load.mockRejectedValue(new Error("db down"));
    expect(await loadLibraryPage({ libraryId: "lib-1", params, offset: 0 })).toMatchObject({ ok: false });
  });
});

describe("saveLibrarySort", () => {
  it("updates only the caller's profile row", async () => {
    expect(await saveLibrarySort({ sort: "title", dir: "desc" })).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(update).toHaveBeenCalledWith({ library_sort: "title", library_sort_dir: "desc" });
    expect(eq).toHaveBeenCalledWith("id", "me");
  });
  it("rejects an unknown sort or direction without writing", async () => {
    expect(await saveLibrarySort({ sort: "nope", dir: "asc" })).toMatchObject({ ok: false });
    expect(await saveLibrarySort({ sort: "title", dir: "sideways" })).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });
  it("reports a failed write", async () => {
    eq.mockResolvedValue({ error: { message: "x" } });
    expect(await saveLibrarySort({ sort: "title", dir: "asc" })).toMatchObject({ ok: false });
  });
});

describe("renameSeries", () => {
  const LIB = "11111111-1111-4111-8111-111111111111";
  const as = (role: string) => context.mockResolvedValue({ user: { id: "me" }, libraries: [{ id: LIB, role }] });
  beforeEach(() => rpc.mockReset().mockResolvedValue({ data: 3, error: null }));

  it("lets owners and editors rename and returns the count", async () => {
    for (const role of ["owner", "editor"]) {
      as(role);
      expect(await renameSeries({ libraryId: LIB, from: "Disney Villains", to: "Villains" })).toEqual({ ok: true, count: 3 });
    }
    expect(rpc).toHaveBeenCalledWith("library_rename_series", { p_library_id: LIB, p_from: "Disney Villains", p_to: "Villains", p_author: null });
  });

  it("refuses viewers and non-members without touching the database", async () => {
    as("viewer");
    expect(await renameSeries({ libraryId: LIB, from: "A", to: "B" })).toMatchObject({ ok: false });
    context.mockResolvedValue({ user: { id: "me" }, libraries: [] });
    expect(await renameSeries({ libraryId: LIB, from: "A", to: "B" })).toMatchObject({ ok: false, error: "That library is not yours." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates: trimmed, 1 to 200 characters, and different from the old name", async () => {
    as("owner");
    expect(await renameSeries({ libraryId: LIB, from: "A", to: "   " })).toMatchObject({ ok: false });
    expect(await renameSeries({ libraryId: LIB, from: "A", to: "x".repeat(201) })).toMatchObject({ ok: false });
    expect(await renameSeries({ libraryId: LIB, from: " A ", to: "A" })).toMatchObject({ ok: false });
    expect(await renameSeries({ libraryId: "nope", from: "A", to: "B" })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    await renameSeries({ libraryId: LIB, from: "  A ", to: " B  " });
    expect(rpc).toHaveBeenCalledWith("library_rename_series", expect.objectContaining({ p_from: "A", p_to: "B" }));
  });

  it("passes the author scope through and reports a database error", async () => {
    as("editor");
    await renameSeries({ libraryId: LIB, from: "A", to: "B", author: " Serena Valentino " });
    expect(rpc).toHaveBeenCalledWith("library_rename_series", expect.objectContaining({ p_author: "Serena Valentino" }));
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await renameSeries({ libraryId: LIB, from: "A", to: "B" })).toEqual({ ok: false, error: "Could not rename the series." });
  });
});

describe("renameAuthor", () => {
  const LIB = "11111111-1111-4111-8111-111111111111";
  const as = (role: string) => context.mockResolvedValue({ user: { id: "me" }, libraries: [{ id: LIB, role }] });
  beforeEach(() => rpc.mockReset().mockResolvedValue({ data: 2, error: null }));

  it("lets owners and editors change a spelling and returns the count", async () => {
    for (const role of ["owner", "editor"]) {
      as(role);
      expect(await renameAuthor({ libraryId: LIB, from: " Gail Z Martin ", to: "Gail Z. Martin" })).toEqual({ ok: true, count: 2 });
    }
    expect(rpc).toHaveBeenCalledWith("library_rename_author", { p_library_id: LIB, p_from: "Gail Z Martin", p_to: "Gail Z. Martin" });
  });

  it("refuses viewers and non-members without touching the database", async () => {
    as("viewer");
    expect(await renameAuthor({ libraryId: LIB, from: "A", to: "B" })).toMatchObject({ ok: false });
    context.mockResolvedValue({ user: { id: "me" }, libraries: [] });
    expect(await renameAuthor({ libraryId: LIB, from: "A", to: "B" })).toMatchObject({ ok: false, error: "That library is not yours." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates the names and reports a database error", async () => {
    as("owner");
    expect(await renameAuthor({ libraryId: LIB, from: "A", to: "  " })).toMatchObject({ ok: false });
    expect(await renameAuthor({ libraryId: LIB, from: "A", to: "x".repeat(201) })).toMatchObject({ ok: false });
    expect(await renameAuthor({ libraryId: LIB, from: "A", to: " A " })).toMatchObject({ ok: false });
    expect(await renameAuthor({ libraryId: "nope", from: "A", to: "B" })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await renameAuthor({ libraryId: LIB, from: "A", to: "B" })).toEqual({ ok: false, error: "Could not change the spelling." });
  });
});
