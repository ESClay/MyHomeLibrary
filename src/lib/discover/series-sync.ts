import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorSurname, normalizeTitle } from "@/lib/duplicates";
import {
  BOOK_BATCH,
  chooseSeriesRef,
  hardcoverSeriesApi,
  pickBookMatch,
  pickSeriesHit,
  seriesPacer,
  type SeriesApi,
} from "@/lib/metadata/hardcover-series";

/*
 * Series sync. Uses the SERVICE ROLE client (series / series_entries are service-write only), which bypasses RLS, so
 * the rule is: everything this reads or writes about *books* is filtered by the one library id it was asked about, and
 * a caller that acts for a signed-in user must check that user's membership first (see requireLibraryMember in the
 * Discover actions). The series tables themselves are a global cache keyed by Hardcover id.
 *
 * Idempotent and resumable: every step upserts, books are stamped with `series_checked_at`, a series is stamped with
 * `synced_at`, and a run stops at its time budget. Running it again carries on with whatever is still stale.
 */

/** A series older than this is fetched again (the weekly refresh). */
export const SERIES_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** A book with no series is looked at again after this long (a new edition may have been filed). */
export const BOOK_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;
/** Most series-name searches in one run (each is one Hardcover request). */
export const MAX_NAME_SEARCHES = 15;
/** Most books looked up on Hardcover by ISBN or title in one run (each is one or two requests); the rest wait for the next run. */
export const MAX_BOOK_LOOKUPS = 30;
export const DEFAULT_BUDGET_MS = 50_000;
/** Headroom kept free so a request that starts before the deadline can finish after it. */
const REQUEST_HEADROOM_MS = 6_000;

export type SyncOptions = {
  budgetMs?: number;
  /** Only this series (a per-series Refresh). It must be linked to a book in the library; it is fetched even if fresh. */
  onlySeriesId?: string;
  /** Skip finding new series and only refresh the ones the library already has. */
  skipDiscovery?: boolean;
  staleMs?: number;
  api?: SeriesApi;
  now?: () => number;
};

export type SyncResult = {
  /** Books newly filed under a series. */
  linkedBooks: number;
  /** Series fetched or refreshed in this run. */
  syncedSeries: number;
  /** Series (or discovery work) still waiting because the budget ran out. */
  remaining: number;
  /** True when nothing is left to do for this library. */
  done: boolean;
  rateLimited: boolean;
  /** Set when Hardcover (or the service role) is not configured. */
  unconfigured?: "hardcover" | "service-role";
  errors: string[];
};

type BookRow = {
  id: string;
  title: string;
  authors: string[] | null;
  series_id: string | null;
  series_name: string | null;
  series_position: number | null;
  hardcover_id: number | null;
  series_checked_at: string | null;
  isbn13?: string | null;
};

const PAGE = 1000;

async function loadBooks(admin: SupabaseClient, libraryId: string): Promise<BookRow[]> {
  const rows: BookRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("books")
      .select("id, title, authors, series_id, series_name, series_position, hardcover_id, series_checked_at, isbn13")
      .eq("library_id", libraryId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read the library's books: ${error.message}`);
    rows.push(...((data ?? []) as BookRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const isRateLimit = (e: unknown) => e instanceof Error && /\b429\b/.test(e.message);

/**
 * Books that still need their series found: unlinked, and not looked at recently. That includes books with no series
 * text and no Hardcover id at all (Google Books, Open Library, photo and Calibre imports): those are looked up first.
 */
export function needsDiscovery(b: Pick<BookRow, "series_id" | "series_checked_at">, now: number): boolean {
  if (b.series_id) return false;
  if (!b.series_checked_at) return true;
  return now - new Date(b.series_checked_at).getTime() > BOOK_RECHECK_MS;
}

/** Groups books that name the same series by the same first author, so one search serves them all. */
export function groupByNamedSeries(books: Pick<BookRow, "id" | "series_name" | "authors">[]): Map<string, { name: string; author: string | null; ids: string[] }> {
  const groups = new Map<string, { name: string; author: string | null; ids: string[] }>();
  for (const b of books) {
    if (!b.series_name) continue;
    const author = b.authors?.[0] ?? null;
    const key = `${normalizeTitle(b.series_name)}|${authorSurname(author ?? undefined)}`;
    const g = groups.get(key) ?? { name: b.series_name, author, ids: [] };
    g.ids.push(b.id);
    groups.set(key, g);
  }
  return groups;
}

export async function syncLibrarySeries(admin: SupabaseClient, libraryId: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const api = opts.api ?? hardcoverSeriesApi;
  const now = opts.now ?? Date.now;
  const started = now();
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = started + budgetMs;
  const staleMs = opts.staleMs ?? SERIES_STALE_MS;
  const pacer = opts.api ? null : seriesPacer(budgetMs);

  const result: SyncResult = { linkedBooks: 0, syncedSeries: 0, remaining: 0, done: false, rateLimited: false, errors: [] };
  if (!api.configured()) return { ...result, unconfigured: "hardcover" };

  /** Waits for the next free request slot; false when the time budget cannot cover another request. */
  async function slot(): Promise<boolean> {
    if (now() + REQUEST_HEADROOM_MS > deadline) return false;
    return pacer ? pacer.take() : true;
  }

  /** Runs one request; a failure is recorded (a 429 flags the whole run as rate limited) and never thrown. */
  async function attempt<T>(what: string, run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      return { ok: true, value: await run() };
    } catch (e) {
      if (isRateLimit(e)) result.rateLimited = true;
      else result.errors.push(`${what}: ${e instanceof Error ? e.message : "failed"}`);
      return { ok: false };
    }
  }

  const books = await loadBooks(admin, libraryId);

  // ------------------------------------------------ 1. find series for books that have none
  let discoveryLeft = 0;
  if (!opts.skipDiscovery && !opts.onlySeriesId) {
    const todo = books.filter((b) => needsDiscovery(b, now()));
    const checked: string[] = [];

    // (0) books with neither a Hardcover id nor a series name: find the book on Hardcover (ISBN-13 first, else title +
    // first author, a confident match only) and store its id, so step (a) can file it. A bounded number per run.
    const usedIds = new Set(books.map((b) => b.hardcover_id).filter((n): n is number => !!n));
    const lookups = todo.filter((b) => !b.hardcover_id && !b.series_name);
    const resolved = new Map<string, number>();
    let looked = 0;
    for (let i = 0; i < lookups.length && !result.rateLimited; i++) {
      const b = lookups[i];
      if (looked >= MAX_BOOK_LOOKUPS || !(await slot())) {
        discoveryLeft += lookups.length - i;
        break;
      }
      looked++;
      let hit: { hardcoverId: number } | null = null;
      let failed = false;
      const isbn = b.isbn13?.trim();
      if (isbn) {
        const res = await attempt("book lookup", () => api.bookByIsbn(isbn));
        if (res.ok) hit = res.value;
        else failed = true;
      }
      const author = b.authors?.[0] ?? null;
      if (!hit && !failed && author && !result.rateLimited) {
        if (await slot()) {
          const res = await attempt("book search", () => api.searchBooks(`${b.title} ${author}`.trim()));
          if (res.ok) hit = pickBookMatch(res.value, { title: b.title, author });
          else failed = true;
        } else {
          failed = true; // out of time before the second request: leave it unstamped for the next run
        }
      }
      if (failed) {
        discoveryLeft++;
        continue;
      }
      if (!hit) {
        checked.push(b.id); // looked up, no confident match: stamped below so it is not asked again for a month
        continue;
      }
      resolved.set(b.id, hit.hardcoverId); // this run files it in step (a)
      // books.hardcover_id is unique across all libraries, so an id already taken is used for this run but not stored.
      if (!usedIds.has(hit.hardcoverId)) {
        usedIds.add(hit.hardcoverId);
        const { error } = await admin.from("books").update({ hardcover_id: hit.hardcoverId }).eq("library_id", libraryId).eq("id", b.id).is("hardcover_id", null);
        if (error && !/duplicate|unique|23505/i.test(`${error.code ?? ""} ${error.message}`)) result.errors.push(`hardcover id: ${error.message}`);
      }
    }

    const ready = todo.map((b) => (resolved.has(b.id) ? { ...b, hardcover_id: resolved.get(b.id) as number } : b));
    const byHardcover = ready.filter((b) => b.hardcover_id);
    const named = ready.filter((b) => !b.hardcover_id && b.series_name);
    const found = new Map<number, { name: string; bookIds: string[] }>(); // hardcover series id -> books

    // (a) books with a Hardcover id: a batch of 40 per request
    for (let i = 0; i < byHardcover.length && !result.rateLimited; i += BOOK_BATCH) {
      if (!(await slot())) {
        discoveryLeft += byHardcover.length - i;
        break;
      }
      const batch = byHardcover.slice(i, i + BOOK_BATCH);
      const res = await attempt("book series", () => api.bookSeries(batch.map((b) => b.hardcover_id as number)));
      if (!res.ok) {
        discoveryLeft += batch.length;
        continue;
      }
      const byId = new Map(res.value.map((l) => [l.bookId, l]));
      for (const b of batch) {
        const ref = chooseSeriesRef(byId.get(b.hardcover_id as number)?.series ?? [], b.series_name);
        checked.push(b.id);
        if (!ref) continue;
        const entry = found.get(ref.seriesId) ?? { name: ref.name, bookIds: [] };
        entry.bookIds.push(b.id);
        found.set(ref.seriesId, entry);
      }
    }

    // (b) books with only a series name: a series search per (name, author), a bounded number per run
    const groups = [...groupByNamedSeries(named).values()];
    let searches = 0;
    for (let i = 0; i < groups.length && !result.rateLimited; i++) {
      const g = groups[i];
      if (searches >= MAX_NAME_SEARCHES || !(await slot())) {
        discoveryLeft += groups.slice(i).reduce((n, x) => n + x.ids.length, 0);
        break;
      }
      searches++;
      const res = await attempt("series search", () => api.searchSeries(`${g.name} ${g.author ?? ""}`.trim()));
      if (!res.ok) {
        discoveryLeft += g.ids.length;
        continue;
      }
      checked.push(...g.ids);
      const hit = pickSeriesHit(res.value, { name: g.name, author: g.author });
      if (!hit) continue;
      const entry = found.get(hit.hardcoverId) ?? { name: hit.name, bookIds: [] };
      entry.bookIds.push(...g.ids);
      found.set(hit.hardcoverId, entry);
    }

    // Persist: series rows first (upsert by Hardcover id), then link this library's books.
    if (found.size > 0) {
      const rows = [...found.entries()].map(([hardcoverId, v]) => ({ hardcover_id: hardcoverId, name: v.name }));
      const { data: saved, error } = await admin.from("series").upsert(rows, { onConflict: "hardcover_id" }).select("id, hardcover_id");
      if (error) {
        result.errors.push(`series: ${error.message}`);
      } else {
        const idByHc = new Map((saved ?? []).map((s) => [Number(s.hardcover_id), s.id as string]));
        const stamp = new Date(now()).toISOString();
        for (const [hc, v] of found) {
          const seriesId = idByHc.get(hc);
          if (!seriesId) continue;
          // `library_id` in the filter is the guard: this write can never touch another library's books.
          const { error: linkError } = await admin
            .from("books")
            .update({ series_id: seriesId, series_checked_at: stamp })
            .eq("library_id", libraryId)
            .in("id", v.bookIds);
          if (linkError) result.errors.push(`link: ${linkError.message}`);
          else result.linkedBooks += v.bookIds.length;
        }
      }
    }
    const linkedIds = new Set([...found.values()].flatMap((v) => v.bookIds));
    const unlinkedChecked = checked.filter((id) => !linkedIds.has(id));
    if (unlinkedChecked.length > 0) {
      await admin
        .from("books")
        .update({ series_checked_at: new Date(now()).toISOString() })
        .eq("library_id", libraryId)
        .in("id", unlinkedChecked);
    }
  }

  // ------------------------------------------------ 2. refresh the entries of this library's stale series
  const { data: linkedRows, error: linkedError } = await admin.from("books").select("series_id").eq("library_id", libraryId).not("series_id", "is", null);
  if (linkedError) result.errors.push(`series list: ${linkedError.message}`);
  const seriesIds = [...new Set((linkedRows ?? []).map((r) => r.series_id as string))].filter((id) => !opts.onlySeriesId || id === opts.onlySeriesId);

  let staleLeft = 0;
  if (seriesIds.length > 0) {
    const { data: seriesRows, error } = await admin.from("series").select("id, hardcover_id, name, synced_at").in("id", seriesIds);
    if (error) result.errors.push(`series: ${error.message}`);
    const cutoff = now() - staleMs;
    const stale = (seriesRows ?? [])
      .filter((s) => s.hardcover_id !== null)
      .filter((s) => opts.onlySeriesId === s.id || !s.synced_at || new Date(s.synced_at as string).getTime() < cutoff)
      .sort((a, b) => (a.synced_at ? new Date(a.synced_at as string).getTime() : 0) - (b.synced_at ? new Date(b.synced_at as string).getTime() : 0));

    for (let i = 0; i < stale.length; i++) {
      if (result.rateLimited || !(await slot())) {
        staleLeft = stale.length - i;
        break;
      }
      const s = stale[i];
      const res = await attempt(`series ${s.name}`, () => api.seriesBooks(Number(s.hardcover_id)));
      if (!res.ok) {
        if (result.rateLimited) {
          staleLeft = stale.length - i;
          break;
        }
        staleLeft++; // a failure other than a rate limit: left stale for the next run
        continue;
      }
      if (res.value === null) {
        // The series was merged into another or removed; there is nothing to store, so do not ask again for a week.
        await admin.from("series").update({ synced_at: new Date(now()).toISOString() }).eq("id", s.id);
        continue;
      }
      if (await writeEntries(admin, s.id as string, res.value)) result.syncedSeries++;
      else result.errors.push(`entries for ${s.name} could not be saved`);
    }
  }

  // ------------------------------------------------ 3. copy the series' name and the book's number onto linked books
  try {
    await fillSeriesFields(admin, libraryId, opts.onlySeriesId);
  } catch (e) {
    result.errors.push(`series names: ${e instanceof Error ? e.message : "failed"}`);
  }

  result.remaining = discoveryLeft + staleLeft;
  result.done = result.remaining === 0 && !result.rateLimited && result.errors.length === 0;
  return result;
}

/**
 * The library list, sort and filters read `books.series_name` / `series_position`, not `series_id`, so a book linked by
 * the sync must carry them too. Fills only what is empty (a typed name or number is never overwritten). Reads once
 * (books, series, entries) and writes grouped updates, so there is no per-book query loop. Returns books changed.
 */
export async function fillSeriesFields(admin: SupabaseClient, libraryId: string, onlySeriesId?: string): Promise<number> {
  const linked = (await loadBooks(admin, libraryId)).filter((b) => b.series_id && (!onlySeriesId || b.series_id === onlySeriesId));
  const needy = linked.filter((b) => !b.series_name?.trim() || b.series_position === null);
  if (needy.length === 0) return 0;

  const seriesIds = [...new Set(needy.map((b) => b.series_id as string))];
  const { data: seriesRows, error } = await admin.from("series").select("id, name").in("id", seriesIds);
  if (error) throw new Error(error.message);
  const nameById = new Map((seriesRows ?? []).map((s) => [s.id as string, (s.name as string | null)?.trim() ?? ""]));

  const hcIds = [...new Set(needy.filter((b) => b.hardcover_id && b.series_position === null).map((b) => b.hardcover_id as number))];
  const position = new Map<string, number>(); // `${series_id}|${hardcover_book_id}` -> position
  for (let i = 0; i < hcIds.length; i += 200) {
    const { data, error: entryError } = await admin
      .from("series_entries")
      .select("series_id, hardcover_book_id, position")
      .in("series_id", seriesIds)
      .in("hardcover_book_id", hcIds.slice(i, i + 200));
    if (entryError) throw new Error(entryError.message);
    for (const e of data ?? []) if (e.position !== null && e.position !== undefined) position.set(`${e.series_id}|${e.hardcover_book_id}`, Number(e.position));
  }

  // Group books that get the same patch into one update each.
  const groups = new Map<string, { patch: Record<string, unknown>; ids: string[] }>();
  for (const b of needy) {
    const patch: Record<string, unknown> = {};
    const name = nameById.get(b.series_id as string);
    if (!b.series_name?.trim() && name) patch.series_name = name;
    if (b.series_position === null && b.hardcover_id) {
      const pos = position.get(`${b.series_id}|${b.hardcover_id}`);
      if (pos !== undefined) patch.series_position = pos;
    }
    if (Object.keys(patch).length === 0) continue;
    const key = JSON.stringify(patch);
    const g = groups.get(key) ?? { patch, ids: [] };
    g.ids.push(b.id);
    groups.set(key, g);
  }
  let changed = 0;
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 200) {
      const ids = g.ids.slice(i, i + 200);
      const { error: writeError } = await admin.from("books").update(g.patch).eq("library_id", libraryId).in("id", ids);
      if (writeError) throw new Error(writeError.message);
      changed += ids.length;
    }
  }
  return changed;
}

/** Upserts a series' entries, removes ones Hardcover no longer lists, and stamps the series. */
async function writeEntries(
  admin: SupabaseClient,
  seriesId: string,
  data: NonNullable<Awaited<ReturnType<SeriesApi["seriesBooks"]>>>,
): Promise<boolean> {
  if (data.entries.length > 0) {
    const rows = data.entries.map((e) => ({
      series_id: seriesId,
      position: e.position,
      title: e.title,
      authors: e.authors,
      hardcover_book_id: e.hardcoverBookId,
      isbn13: e.isbn13,
      cover_url: e.coverUrl,
      release_date: e.releaseDate,
      is_compilation: e.isCompilation,
      details: e.details,
    }));
    const { error } = await admin.from("series_entries").upsert(rows, { onConflict: "series_id,hardcover_book_id" });
    if (error) return false;
    const keep = data.entries.map((e) => e.hardcoverBookId);
    await admin.from("series_entries").delete().eq("series_id", seriesId).not("hardcover_book_id", "in", `(${keep.join(",")})`);
  }
  const { error } = await admin
    .from("series")
    .update({ name: data.name, author_name: data.authorName, synced_at: new Date().toISOString() })
    .eq("id", seriesId);
  return !error;
}
