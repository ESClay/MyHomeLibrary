import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const CURRENT_LIBRARY_COOKIE = "current_library";

export type LibraryRole = "owner" | "editor" | "viewer";

export type LibrarySummary = {
  id: string;
  name: string;
  role: LibraryRole;
};

/** Signed-in user, or redirect to sign-in. Verified against the auth server. */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");
  return data.user;
});

/** Libraries the user belongs to plus the currently selected one (cookie, else first). */
export const getLibraryContext = cache(async () => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("library_members")
    .select("role, libraries(id, name)")
    .eq("user_id", user.id)
    .order("created_at");

  const libraries: LibrarySummary[] = (data ?? []).flatMap((row) => {
    const lib = Array.isArray(row.libraries) ? row.libraries[0] : row.libraries;
    return lib ? [{ id: lib.id, name: lib.name, role: row.role as LibraryRole }] : [];
  });

  const cookieStore = await cookies();
  const savedId = cookieStore.get(CURRENT_LIBRARY_COOKIE)?.value;
  const current = libraries.find((l) => l.id === savedId) ?? libraries[0] ?? null;

  return { user, libraries, current };
});
