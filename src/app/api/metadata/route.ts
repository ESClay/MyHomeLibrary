import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { looksLikeIsbn } from "@/lib/isbn";
import { providerPolicyFor } from "@/lib/access";
import { lookupByIsbn, search } from "@/lib/metadata";

/**
 * GET /api/metadata?q=<title, author or ISBN>   -> { results: BookMetadata[] }
 * GET /api/metadata?isbn=<isbn>                 -> { results: [BookMetadata] | [] }
 * Signed-in users only; provider keys never leave the server. Without full access only Open Library is queried.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  // Hardcover and Google are for people with full access; everyone else is answered from Open Library only.
  const policy = await providerPolicyFor(supabase, data.user.id);

  const params = request.nextUrl.searchParams;
  const isbn = params.get("isbn")?.trim();
  const q = params.get("q")?.trim().slice(0, 200);

  try {
    if (isbn) {
      if (!looksLikeIsbn(isbn)) return NextResponse.json({ results: [] });
      const one = await lookupByIsbn(isbn, policy);
      return NextResponse.json({ results: one ? [one] : [] });
    }
    if (!q || q.length < 2) return NextResponse.json({ results: [] });
    return NextResponse.json({ results: await search(q, policy) });
  } catch {
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 502 });
  }
}
