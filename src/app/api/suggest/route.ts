import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { search } from "@/lib/metadata";
import { LIBRARY_LIMIT, MAX_QUERY_LENGTH, MIN_CHARS, ONLINE_LIMIT, likePatterns, normalizeQuery, type LibrarySuggestion } from "@/lib/typeahead";

const params = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("library"),
    q: z.string().max(MAX_QUERY_LENGTH * 2),
    library: z.uuid(),
  }),
  z.object({ source: z.literal("online"), q: z.string().max(MAX_QUERY_LENGTH * 2) }),
]);

/**
 * GET /api/suggest?source=library&library=<uuid>&q=<text> -> { results: LibrarySuggestion[] }
 * GET /api/suggest?source=online&q=<text>                 -> { results: BookMetadata[] }
 * Signed-in users only. Library matches run as the user (RLS), so only libraries they belong to return rows.
 * Online matches go through lib/metadata, whose fetch layer caches repeated queries for 5 minutes.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const parsed = params.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const q = normalizeQuery(parsed.data.q);
  if (q.length < MIN_CHARS) return NextResponse.json({ results: [] });

  try {
    if (parsed.data.source === "library") {
      let query = supabase
        .from("books")
        .select("id, title, authors, series_name, series_position, cover_url, isbn13")
        .eq("library_id", parsed.data.library);
      for (const pattern of likePatterns(q)) query = query.ilike("search_text", pattern);
      const { data, error } = await query.order("title").limit(LIBRARY_LIMIT);
      if (error) throw new Error(error.message);
      const results: LibrarySuggestion[] = (data ?? []).map((r) => ({
        id: r.id as string,
        title: r.title as string,
        authors: (r.authors as string[]) ?? [],
        seriesName: (r.series_name as string | null) ?? null,
        seriesPosition: r.series_position === null ? null : Number(r.series_position),
        coverUrl: (r.cover_url as string | null) ?? null,
        isbn13: (r.isbn13 as string | null) ?? null,
      }));
      return NextResponse.json({ results });
    }
    const found = await search(q);
    return NextResponse.json({ results: found.slice(0, ONLINE_LIMIT + LIBRARY_LIMIT) });
  } catch {
    return NextResponse.json({ error: "Suggestions are unavailable right now." }, { status: 502 });
  }
}
