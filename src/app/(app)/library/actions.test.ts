import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_SIZE, parseLibraryParams, type LibraryItem } from "@/lib/books/library-query";

const context = vi.fn();
const load = vi.fn();
vi.mock("@/lib/library", () => ({ getLibraryContext: () => context() }));
vi.mock("@/lib/books/data", () => ({ loadLibraryPageItems: (...a: unknown[]) => load(...a) }));

import { loadLibraryPage } from "./actions";

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
    expect(load.mock.calls[0][2]).toMatchObject({ sort: "added" });
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
