/**
 * The hosts book covers are served from, shared by next.config.ts (images.remotePatterns) and isOptimizableCover.
 * No imports here: next.config.ts loads this file directly.
 * Keep it in step with the metadata providers in src/lib/metadata and the "covers" storage bucket.
 */
export type CoverHostRule = {
  protocol: "https";
  hostname: string;
  pathname: string;
  /** "" means no query string is allowed; leave it out to allow any (Google Books needs id/zoom/img parameters). */
  search?: "";
};

export const PROVIDER_COVER_HOSTS: CoverHostRule[] = [
  // Hardcover: https://assets.hardcover.app/edition/<id>/<hash>.jpg and similar
  { protocol: "https", hostname: "assets.hardcover.app", pathname: "/**", search: "" },
  // Google Books: https://books.google.com/books/content?id=...&zoom=2 (the API often says http; we upgrade to https)
  { protocol: "https", hostname: "books.google.com", pathname: "/books/**" },
  { protocol: "https", hostname: "books.googleusercontent.com", pathname: "/**" },
  // Open Library: https://covers.openlibrary.org/b/id/<n>-L.jpg (redirects to archive.org; redirects need not match)
  { protocol: "https", hostname: "covers.openlibrary.org", pathname: "/b/**", search: "" },
];

/** Our own public "covers" bucket on Supabase (photo-scan and uploaded covers). Null for local or unset Supabase. */
export function supabaseCoverHost(supabaseUrl: string | undefined): CoverHostRule | null {
  if (!supabaseUrl) return null;
  try {
    const u = new URL(supabaseUrl);
    if (u.protocol !== "https:" || isLocalHost(u.hostname)) return null;
    return { protocol: "https", hostname: u.hostname, pathname: "/storage/v1/object/public/covers/**" };
  } catch {
    return null;
  }
}

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname);
}

export function coverHostRules(supabaseUrl: string | undefined): CoverHostRule[] {
  const own = supabaseCoverHost(supabaseUrl);
  return own ? [...PROVIDER_COVER_HOSTS, own] : PROVIDER_COVER_HOSTS;
}
