import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AddedRow, RatingRow, ReadingRow, UnreadRow, ValueRow } from "./aggregate";

export type ShelfValue = { shelfId: string; name: string; copies: number; priced: number; estValue: number; paid: number };
export type TopCopy = { copyId: string; bookId: string; title: string; authors: string[]; coverUrl: string | null; format: string; price: number; paid: number | null; approximate: boolean };
export type Labelled = { label: string; books: number };

export type StatsData = {
  reading: ReadingRow[];
  ratings: RatingRow[];
  added: AddedRow[];
  unread: UnreadRow[];
  formats: { format: string; copies: number }[];
  topAuthors: Labelled[];
  topGenres: Labelled[];
  topSeries: Labelled[];
  /** Null when the library has no price region, so there is no currency to total in. */
  value: { total: ValueRow; byShelf: ShelfValue[]; top: TopCopy[] } | null;
};

const num = (v: unknown) => Number(v ?? 0);

/**
 * Every figure comes from a SQL function that runs as the signed-in user (security invoker), so row-level security decides what is
 * counted and the browser never receives the library's rows, only the aggregates. Nine small queries, in parallel.
 */
export async function loadStats(libraryId: string, currency: string | null): Promise<StatsData> {
  const db = await createClient();
  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T[]> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return (data ?? []) as T[];
  };
  const lib = { lib: libraryId };

  const [reading, ratings, added, unread, formats, authors, genres, series, valueRows, shelves, top] = await Promise.all([
    rpc<{ user_id: string; month: string; books: number; pages: number }>("stats_reading", lib),
    rpc<{ user_id: string; half_stars: number; books: number }>("stats_ratings", lib),
    rpc<{ month: string; ownership: AddedRow["ownership"]; books: number }>("stats_added", lib),
    rpc<{ user_id: string; owned: number; read: number; reading: number; unread: number }>("stats_unread", lib),
    rpc<{ format: string; copies: number }>("stats_formats", lib),
    rpc<{ label: string; books: number }>("stats_top", { ...lib, kind: "author", max_rows: 8 }),
    rpc<{ label: string; books: number }>("stats_top", { ...lib, kind: "genre", max_rows: 8 }),
    rpc<{ label: string; books: number }>("stats_top", { ...lib, kind: "series", max_rows: 8 }),
    currency ? rpc<Record<string, unknown>>("stats_value", { ...lib, cur: currency }) : Promise.resolve([]),
    currency ? rpc<Record<string, unknown>>("stats_value_by_shelf", { ...lib, cur: currency }) : Promise.resolve([]),
    currency ? rpc<Record<string, unknown>>("stats_top_copies", { ...lib, cur: currency }) : Promise.resolve([]),
  ]);

  const v = valueRows[0];
  return {
    reading: reading.map((r) => ({ userId: r.user_id, month: r.month, books: num(r.books), pages: num(r.pages) })),
    ratings: ratings.map((r) => ({ userId: r.user_id, halfStars: num(r.half_stars), books: num(r.books) })),
    added: added.map((r) => ({ month: r.month, ownership: r.ownership, books: num(r.books) })),
    unread: unread.map((r) => ({ userId: r.user_id, owned: num(r.owned), read: num(r.read), reading: num(r.reading), unread: num(r.unread) })),
    formats: formats.map((f) => ({ format: f.format, copies: num(f.copies) })),
    topAuthors: authors.map((a) => ({ label: a.label, books: num(a.books) })),
    topGenres: genres.map((a) => ({ label: a.label, books: num(a.books) })),
    topSeries: series.map((a) => ({ label: a.label, books: num(a.books) })),
    value:
      currency && v
        ? {
            total: {
              copies: num(v.copies),
              priced: num(v.priced),
              unpriced: num(v.unpriced),
              otherCurrency: num(v.other_currency),
              estValue: num(v.est_value),
              paid: num(v.paid),
              paidPriced: num(v.paid_priced),
            },
            byShelf: shelves.map((s) => ({ shelfId: s.shelf_id as string, name: s.shelf_name as string, copies: num(s.copies), priced: num(s.priced), estValue: num(s.est_value), paid: num(s.paid) })),
            top: top.map((t) => ({
              copyId: t.copy_id as string,
              bookId: t.book_id as string,
              title: t.title as string,
              authors: (t.authors as string[]) ?? [],
              coverUrl: (t.cover_url as string | null) ?? null,
              format: t.format as string,
              price: num(t.price),
              paid: t.paid === null || t.paid === undefined ? null : num(t.paid),
              approximate: !!t.approximate,
            })),
          }
        : null,
  };
}
