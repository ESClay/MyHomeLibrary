import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeGaps, type GapEntry, type GapSeries, type SeriesGap } from "./gaps";
import { loadLibraryBooks } from "./recs";

export type SeriesOverview = {
  gaps: SeriesGap[];
  /** Books that name a series (or have a Hardcover id) but are not filed under one yet. */
  unsynced: number;
  /** Books that mention any series at all. */
  withSeriesText: number;
  completeCount: number;
};

type EntryRow = {
  id: string;
  position: number | null;
  title: string;
  authors: string[] | null;
  hardcover_book_id: number | null;
  isbn13: string | null;
  cover_url: string | null;
  release_date: string | null;
  is_compilation: boolean;
};

/** The library's series gaps, read through the signed-in user's own client (series tables are readable by signed-in users). */
export async function loadSeriesOverview(client: SupabaseClient, libraryId: string): Promise<SeriesOverview> {
  const books = await loadLibraryBooks(client, libraryId);
  const { data: textRows } = await client.from("books").select("id, series_id, series_name, hardcover_id").eq("library_id", libraryId);
  const withSeriesText = (textRows ?? []).filter((b) => b.series_id || b.series_name).length;
  const unsynced = (textRows ?? []).filter((b) => !b.series_id && (b.series_name || b.hardcover_id)).length;

  const seriesIds = [...new Set(books.map((b) => b.seriesId).filter((s): s is string => !!s))];
  let series: GapSeries[] = [];
  if (seriesIds.length > 0) {
    const { data, error } = await client
      .from("series")
      .select("id, name, hardcover_id, synced_at, author_name, series_entries(id, position, title, authors, hardcover_book_id, isbn13, cover_url, release_date, is_compilation)")
      .in("id", seriesIds);
    if (error) throw new Error(error.message);
    series = (data ?? []).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      hardcoverId: s.hardcover_id === null ? null : Number(s.hardcover_id),
      syncedAt: s.synced_at as string | null,
      authorName: s.author_name as string | null,
      entries: ((s.series_entries ?? []) as EntryRow[]).map(
        (e): GapEntry => ({
          id: e.id,
          position: e.position === null ? null : Number(e.position),
          title: e.title,
          authors: e.authors ?? [],
          hardcoverBookId: e.hardcover_book_id === null ? null : Number(e.hardcover_book_id),
          isbn13: e.isbn13,
          coverUrl: e.cover_url,
          releaseDate: e.release_date,
          isCompilation: e.is_compilation,
        }),
      ),
    }));
  }
  const gaps = computeGaps({ books, series });
  return { gaps, unsynced, withSeriesText, completeCount: gaps.filter((g) => !g.pending && g.total > 0 && g.missing.length === 0).length };
}
