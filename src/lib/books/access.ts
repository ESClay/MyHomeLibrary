import "server-only";
import { requireUser, type LibraryRole } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function firstIssue(error: { issues: { message: string; path: PropertyKey[] }[] }): string {
  const i = error.issues[0];
  return i?.message ?? "That doesn't look right.";
}

/** The signed-in user's role in a library, or null when they are not a member. */
export async function roleInLibrary(libraryId: string, userId: string): Promise<LibraryRole | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("library_members")
    .select("role")
    .eq("library_id", libraryId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as LibraryRole | undefined) ?? null;
}

export const canEdit = (role: LibraryRole | null) => role === "owner" || role === "editor";

/**
 * Loads a book through RLS and checks the user's role. `edit: true` demands owner or editor.
 * Returns an error string instead of throwing so actions can pass it straight to the UI.
 */
export async function authorizeBook(bookId: string, edit: boolean) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: book } = await supabase
    .from("books")
    .select("id, library_id, title, authors, isbn13, cover_url")
    .eq("id", bookId)
    .maybeSingle();
  if (!book) return { ok: false as const, error: "That book is not in your library." };
  const role = await roleInLibrary(book.library_id, user.id);
  if (!role) return { ok: false as const, error: "That book is not in your library." };
  if (edit && !canEdit(role)) return { ok: false as const, error: "Only owners and editors can change the library." };
  return { ok: true as const, user, supabase, book, role };
}
