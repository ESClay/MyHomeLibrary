import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currencyFor, localeOrDefault } from "@/lib/regions";
import { createClient } from "@/lib/supabase/server";

export const CURRENT_LIBRARY_COOKIE = "current_library";

export type LibraryRole = "owner" | "editor" | "viewer";

export type LibrarySummary = {
  id: string;
  name: string;
  role: LibraryRole;
  /** eBay marketplace the library prices in; null until the owner has chosen a region (prices are off meanwhile). */
  priceRegion: string | null;
};

/** The signed-in person, as far as pages and actions need them. */
export type SessionUser = { id: string; email: string | null };

/**
 * Signed-in user, or redirect to sign-in. Reads the verified JWT claims (the proxy has already refreshed the session
 * on this request), so it costs no round trip to the auth server. Data access is still enforced by RLS.
 */
export const requireUser = cache(async (): Promise<SessionUser> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/sign-in");
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

/** Libraries the user belongs to plus the currently selected one (cookie, else first). */
export const getLibraryContext = cache(async () => {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data }, { data: profile }, cookieStore] = await Promise.all([
    supabase.from("library_members").select("role, libraries(id, name, price_region)").eq("user_id", user.id).order("created_at"),
    supabase.from("profiles").select("region, locale").eq("id", user.id).maybeSingle(),
    cookies(),
  ]);

  const libraries: LibrarySummary[] = (data ?? []).flatMap((row) => {
    const lib = Array.isArray(row.libraries) ? row.libraries[0] : row.libraries;
    return lib ? [{ id: lib.id, name: lib.name, role: row.role as LibraryRole, priceRegion: (lib.price_region as string | null) ?? null }] : [];
  });

  const savedId = cookieStore.get(CURRENT_LIBRARY_COOKIE)?.value;
  const current = libraries.find((l) => l.id === savedId) ?? libraries[0] ?? null;

  const region = (profile?.region as string | null | undefined) ?? null;
  const locale = localeOrDefault(profile?.locale as string | null | undefined);
  /** What money in the current library is shown in; null while the library has no price region. */
  const currency = currencyFor(current?.priceRegion);

  return { user, libraries, current, region, locale, currency };
});
