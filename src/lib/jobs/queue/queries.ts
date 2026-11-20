import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { changeState } from "./changes";
import { rowToJob } from "./store-row";
import type { Job } from "./types";

/*
 * Reads for the pages, through the signed-in person's client (RLS: members read their library's jobs). Every read
 * degrades to "nothing" when the jobs tables are missing or the query fails, so a deploy that runs ahead of its
 * migration shows an empty Activity page rather than an error.
 */

/** Finished jobs this person asked for and has not opened yet, newest first. Feeds the nav badge and the notice. */
export const loadUnseenJobs = cache(async (userId: string): Promise<Job[]> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("user_id", userId)
      .is("seen_at", null)
      .in("status", ["done", "failed"])
      .order("finished_at", { ascending: false })
      .limit(20);
    if (error || !data) return [];
    return data.map(rowToJob);
  } catch {
    return [];
  }
});

/** The queued or running series lookup of a library, if any. */
export async function loadActiveSeriesJob(supabase: SupabaseClient, libraryId: string): Promise<Job | null> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("library_id", libraryId)
      .eq("kind", "series_lookup")
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();
    return error || !data ? null : rowToJob(data);
  } catch {
    return null;
  }
}

/** Active jobs and the latest finished ones for the Activity page. */
export async function loadLibraryJobs(supabase: SupabaseClient, libraryId: string): Promise<{ active: Job[]; finished: Job[] }> {
  try {
    const [active, finished] = await Promise.all([
      supabase.from("jobs").select("*").eq("library_id", libraryId).in("status", ["queued", "running"]).order("created_at", { ascending: false }),
      supabase.from("jobs").select("*").eq("library_id", libraryId).in("status", ["done", "failed", "cancelled"]).order("finished_at", { ascending: false }).limit(20),
    ]);
    return { active: (active.data ?? []).map(rowToJob), finished: (finished.data ?? []).map(rowToJob) };
  } catch {
    return { active: [], finished: [] };
  }
}

/** One job of a library, or null. */
export async function loadJob(supabase: SupabaseClient, libraryId: string, jobId: string): Promise<Job | null> {
  try {
    const { data } = await supabase.from("jobs").select("*").eq("library_id", libraryId).eq("id", jobId).maybeSingle();
    return data ? rowToJob(data) : null;
  } catch {
    return null;
  }
}

export type ReviewRow = {
  bookId: string;
  title: string;
  author: string | null;
  oldText: string;
  newText: string;
  state: "applied" | "edited" | "undone";
};

type Side = Partial<Record<"series_id" | "series_name" | "series_position" | "hardcover_id", string | number | null>>;
type BookNow = { title: string; authors: string[] | null; series_id: string | null; series_name: string | null; series_position: number | null; hardcover_id: number | null };

const seriesText = (name: string | null | undefined, position: string | number | null | undefined) =>
  name ? (position !== null && position !== undefined ? `${name} #${position}` : name) : null;

/** The "old → new" pair for one book: its series and number before the job and after it. */
export function describeChange(before: Side, after: Side, book: Pick<BookNow, "series_name" | "series_position">, seriesNames: Map<string, string>): { oldText: string; newText: string } {
  const touchesSeries = ["series_id", "series_name", "series_position"].some((k) => k in before || k in after);
  if (!touchesSeries) return { oldText: "Not matched", newText: "Matched on Hardcover, no series found" };
  const name = (side: Side, resolve: boolean) =>
    "series_name" in side ? ((side.series_name as string | null) || null) : resolve && typeof side.series_id === "string" ? (seriesNames.get(side.series_id) ?? null) : (book.series_name || null);
  const position = (side: Side) => ("series_position" in side ? (side.series_position ?? null) : book.series_position);
  const oldName = name(before, false);
  const newName = name(after, true) ?? book.series_name ?? null;
  return { oldText: seriesText(oldName, position(before)) ?? "No series", newText: seriesText(newName, position(after)) ?? "A series" };
}

/** The recorded changes of one job with each book's title, how it reads before and after, and whether it was edited since. */
export async function loadSeriesReview(supabase: SupabaseClient, jobId: string): Promise<ReviewRow[]> {
  try {
    const rows: { book_id: string; before: Side; after: Side; undone_at: string | null; books: BookNow | BookNow[] | null }[] = [];
    for (let from = 0; from < 5000; from += 1000) {
      const { data, error } = await supabase
        .from("job_changes")
        .select("book_id, before, after, undone_at, books(title, authors, series_id, series_name, series_position, hardcover_id)")
        .eq("job_id", jobId)
        .order("book_id")
        .range(from, from + 999);
      if (error || !data) break;
      rows.push(...(data as unknown as typeof rows));
      if (data.length < 1000) break;
    }
    const ids = [...new Set(rows.flatMap((r) => (typeof r.after.series_id === "string" ? [r.after.series_id] : [])))];
    const seriesNames = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from("series").select("id, name").in("id", ids.slice(i, i + 200));
      for (const s of data ?? []) seriesNames.set(s.id as string, s.name as string);
    }
    return rows
      .map((r) => {
        const book = Array.isArray(r.books) ? r.books[0] : r.books;
        if (!book) return null;
        const { oldText, newText } = describeChange(r.before, r.after, book, seriesNames);
        return {
          bookId: r.book_id,
          title: book.title,
          author: book.authors?.[0] ?? null,
          oldText,
          newText,
          state: changeState({ before: r.before, after: r.after, undoneAt: r.undone_at }, book),
        } satisfies ReviewRow;
      })
      .filter((r): r is ReviewRow => r !== null)
      .sort((a, b) => a.title.localeCompare(b.title));
  } catch {
    return [];
  }
}
