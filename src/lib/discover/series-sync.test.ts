import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeriesApi } from "@/lib/metadata/hardcover-series";
import { groupByNamedSeries, needsDiscovery, syncLibrarySeries } from "./series-sync";

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the slice of supabase-js the sync uses. */
function fakeAdmin(tables: Record<string, Row[]>) {
  let counter = 0;
  const calls: { table: string; op: string; filters: string[] }[] = [];
  function from(table: string) {
    tables[table] ??= [];
    let op: "select" | "update" | "upsert" | "delete" = "select";
    let patch: Row | Row[] = {};
    let onConflict = "";
    const preds: ((r: Row) => boolean)[] = [];
    const filters: string[] = [];
    let wantSelect = false;
    const q = {
      select: () => {
        if (op === "select") op = "select";
        wantSelect = true;
        return q;
      },
      update: (p: Row) => ((op = "update"), (patch = p), q),
      upsert: (p: Row[], o: { onConflict: string }) => ((op = "upsert"), (patch = p), (onConflict = o.onConflict), q),
      delete: () => ((op = "delete"), q),
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), filters.push(`${c}=${String(v)}`), q),
      in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), filters.push(`${c} in`), q),
      not: (c: string, o: string, v: unknown) => {
        if (o === "is") preds.push((r) => (v === null ? r[c] !== null && r[c] !== undefined : r[c] !== v));
        else preds.push((r) => !String(v).replace(/[()]/g, "").split(",").map(Number).includes(Number(r[c])));
        return q;
      },
      order: () => q,
      range: () => q,
      then(resolve: (v: { data: Row[] | null; error: null }) => void) {
        calls.push({ table, op, filters });
        const rows = tables[table];
        let data: Row[] = [];
        if (op === "select") data = rows.filter((r) => preds.every((p) => p(r)));
        if (op === "update") {
          data = rows.filter((r) => preds.every((p) => p(r)));
          for (const r of data) Object.assign(r, patch);
        }
        if (op === "delete") tables[table] = rows.filter((r) => !preds.every((p) => p(r)));
        if (op === "upsert") {
          const keys = onConflict.split(",");
          for (const p of patch as Row[]) {
            const hit = rows.find((r) => keys.every((k) => r[k] === p[k]));
            if (hit) Object.assign(hit, p);
            else rows.push({ id: `id${++counter}`, synced_at: null, ...p });
            data.push(hit ?? rows[rows.length - 1]);
          }
        }
        resolve({ data: wantSelect || op === "select" ? data : null, error: null });
      },
    };
    return q;
  }
  return { client: { from } as unknown as SupabaseClient, calls, tables };
}

function api(over: Partial<SeriesApi> = {}): SeriesApi & { bookSeries: ReturnType<typeof vi.fn>; seriesBooks: ReturnType<typeof vi.fn>; searchSeries: ReturnType<typeof vi.fn> } {
  return {
    configured: () => true,
    bookSeries: vi.fn(async (ids: number[]) =>
      ids.map((id) => ({ bookId: id, title: null, series: id === 1 ? [{ seriesId: 1150, name: "Dune", featured: true, position: 1, compilation: false }] : [] })),
    ),
    seriesBooks: vi.fn(async (id: number) => ({
      hardcoverId: id,
      name: "Dune",
      authorName: "Frank Herbert",
      booksCount: 2,
      skipped: 0,
      entries: [
        { position: 1, details: "1", hardcoverBookId: 11, title: "Dune", authors: ["Frank Herbert"], releaseDate: "1965-06-01", isbn13: null, coverUrl: null, isCompilation: false },
        { position: 2, details: "2", hardcoverBookId: 12, title: "Dune Messiah", authors: ["Frank Herbert"], releaseDate: "1969-01-01", isbn13: null, coverUrl: null, isCompilation: false },
      ],
    })),
    searchSeries: vi.fn(async () => []),
    ...over,
  } as never;
}

const LIB = "lib-a";
const books = (): Row[] => [
  { id: "b1", library_id: LIB, title: "Dune", authors: ["Frank Herbert"], series_id: null, series_name: null, hardcover_id: 1, series_checked_at: null },
  { id: "b2", library_id: LIB, title: "Loose", authors: ["A"], series_id: null, series_name: null, hardcover_id: 2, series_checked_at: null },
  { id: "other", library_id: "lib-b", title: "Other Library Book", authors: ["Z"], series_id: null, series_name: null, hardcover_id: 1, series_checked_at: null },
];

describe("syncLibrarySeries", () => {
  it("files books under series, stores the entries, and stamps what it checked", async () => {
    const { client, tables } = fakeAdmin({ books: books(), series: [], series_entries: [] });
    const a = api();
    const res = await syncLibrarySeries(client, LIB, { api: a });
    expect(res).toMatchObject({ linkedBooks: 1, syncedSeries: 1, remaining: 0, done: true, rateLimited: false });
    expect(a.bookSeries).toHaveBeenCalledTimes(1);
    expect(a.bookSeries).toHaveBeenCalledWith([1, 2]);
    const series = tables.series[0];
    expect(series).toMatchObject({ hardcover_id: 1150, name: "Dune" });
    expect(series.synced_at).toBeTruthy();
    expect(tables.series_entries.map((e) => e.title)).toEqual(["Dune", "Dune Messiah"]);
    const b1 = tables.books.find((b) => b.id === "b1")!;
    expect(b1.series_id).toBe(series.id);
    expect(b1.series_checked_at).toBeTruthy();
    // b2 has no series: stamped so it is not asked about again.
    expect(tables.books.find((b) => b.id === "b2")!.series_checked_at).toBeTruthy();
  });

  it("only touches the library it was asked about", async () => {
    const { client, tables } = fakeAdmin({ books: books(), series: [], series_entries: [] });
    await syncLibrarySeries(client, LIB, { api: api() });
    const other = tables.books.find((b) => b.id === "other")!;
    expect(other.series_id).toBeNull();
    expect(other.series_checked_at).toBeNull();
  });

  it("is idempotent: a second run makes no lookups and changes nothing", async () => {
    const { client, tables } = fakeAdmin({ books: books(), series: [], series_entries: [] });
    await syncLibrarySeries(client, LIB, { api: api() });
    const snapshot = JSON.stringify(tables);
    const a = api();
    const res = await syncLibrarySeries(client, LIB, { api: a });
    expect(a.bookSeries).not.toHaveBeenCalled();
    expect(a.seriesBooks).not.toHaveBeenCalled(); // the series is fresh
    expect(res).toMatchObject({ linkedBooks: 0, syncedSeries: 0, done: true });
    expect(JSON.stringify(tables)).toBe(snapshot);
  });

  it("refreshes a stale series and drops entries Hardcover no longer lists", async () => {
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const { client, tables } = fakeAdmin({
      books: [{ id: "b1", library_id: LIB, title: "Dune", authors: [], series_id: "s1", series_name: null, hardcover_id: 1, series_checked_at: old }],
      series: [{ id: "s1", hardcover_id: 1150, name: "Dune", synced_at: old }],
      series_entries: [{ id: "x", series_id: "s1", hardcover_book_id: 99, title: "Gone" }],
    });
    const a = api();
    const res = await syncLibrarySeries(client, LIB, { api: a });
    expect(res.syncedSeries).toBe(1);
    expect(tables.series_entries.map((e) => e.title).sort()).toEqual(["Dune", "Dune Messiah"]);
  });

  it("a per-series refresh fetches that series even when it is fresh, and only that one", async () => {
    const fresh = new Date().toISOString();
    const { client } = fakeAdmin({
      books: [
        { id: "b1", library_id: LIB, title: "A", authors: [], series_id: "s1", series_name: null, hardcover_id: null, series_checked_at: fresh },
        { id: "b2", library_id: LIB, title: "B", authors: [], series_id: "s2", series_name: null, hardcover_id: null, series_checked_at: fresh },
      ],
      series: [
        { id: "s1", hardcover_id: 1, name: "One", synced_at: fresh },
        { id: "s2", hardcover_id: 2, name: "Two", synced_at: fresh },
      ],
      series_entries: [],
    });
    const a = api();
    await syncLibrarySeries(client, LIB, { api: a, onlySeriesId: "s2" });
    expect(a.seriesBooks).toHaveBeenCalledTimes(1);
    expect(a.seriesBooks).toHaveBeenCalledWith(2);
    expect(a.bookSeries).not.toHaveBeenCalled();
  });

  it("stops on a rate limit, reports it, and leaves the rest for the next run", async () => {
    const { client, tables } = fakeAdmin({ books: books(), series: [], series_entries: [] });
    const a = api({ bookSeries: vi.fn(async () => { throw new Error("HTTP 429"); }) as never });
    const res = await syncLibrarySeries(client, LIB, { api: a });
    expect(res).toMatchObject({ rateLimited: true, done: false, linkedBooks: 0 });
    expect(res.remaining).toBeGreaterThan(0);
    expect(tables.books.find((b) => b.id === "b1")!.series_checked_at).toBeNull(); // not stamped: it will be retried
  });

  it("stops at its time budget instead of starting another request", async () => {
    let t = 1_000_000;
    const slow = api({ seriesBooks: vi.fn(async () => { t += 60_000; return null; }) as never });
    const { client } = fakeAdmin({
      books: [
        { id: "b1", library_id: LIB, title: "A", authors: [], series_id: "s1", series_name: null, hardcover_id: null, series_checked_at: "x" },
        { id: "b2", library_id: LIB, title: "B", authors: [], series_id: "s2", series_name: null, hardcover_id: null, series_checked_at: "x" },
      ],
      series: [
        { id: "s1", hardcover_id: 1, name: "One", synced_at: null },
        { id: "s2", hardcover_id: 2, name: "Two", synced_at: null },
      ],
      series_entries: [],
    });
    const res = await syncLibrarySeries(client, LIB, { api: slow, budgetMs: 30_000, now: () => t });
    expect(slow.seriesBooks).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ done: false, remaining: 1 });
  });

  it("finds series for books with only a series name by search", async () => {
    const { client, tables } = fakeAdmin({
      books: [{ id: "n1", library_id: LIB, title: "Dune", authors: ["Frank Herbert"], series_id: null, series_name: "Dune", hardcover_id: null, series_checked_at: null }],
      series: [],
      series_entries: [],
    });
    const a = api({ searchSeries: vi.fn(async () => [{ hardcoverId: 1150, name: "Dune", authorName: "Frank Herbert", booksCount: 19, primaryBooksCount: 6, readersCount: 100 }]) as never });
    const res = await syncLibrarySeries(client, LIB, { api: a });
    expect(a.searchSeries).toHaveBeenCalledWith("Dune Frank Herbert");
    expect(res.linkedBooks).toBe(1);
    expect(tables.books[0].series_id).toBe(tables.series[0].id);
  });

  it("says so when Hardcover is not configured, without touching anything", async () => {
    const { client, calls } = fakeAdmin({ books: books() });
    const res = await syncLibrarySeries(client, LIB, { api: api({ configured: () => false }) });
    expect(res.unconfigured).toBe("hardcover");
    expect(calls).toEqual([]);
  });
});

describe("helpers", () => {
  const now = Date.now();
  it("decides which books need a series lookup", () => {
    const base = { series_id: null, series_checked_at: null, hardcover_id: 5, series_name: null };
    expect(needsDiscovery(base, now)).toBe(true);
    expect(needsDiscovery({ ...base, series_id: "s" }, now)).toBe(false);
    expect(needsDiscovery({ ...base, hardcover_id: null }, now)).toBe(false);
    expect(needsDiscovery({ ...base, series_checked_at: new Date(now - 1000).toISOString() }, now)).toBe(false);
    expect(needsDiscovery({ ...base, series_checked_at: new Date(now - 40 * 86400000).toISOString() }, now)).toBe(true);
  });

  it("groups books naming the same series and author together", () => {
    const g = groupByNamedSeries([
      { id: "1", series_name: "The Witcher", authors: ["Andrzej Sapkowski"] },
      { id: "2", series_name: "witcher", authors: ["Sapkowski, Andrzej"] },
      { id: "3", series_name: "The Witcher", authors: ["Someone Else"] },
      { id: "4", series_name: null, authors: [] },
    ]);
    expect([...g.values()].map((x) => x.ids)).toEqual([["1", "2"], ["3"]]);
  });
});
