import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LibraryRole } from "@/lib/library";
import { appendPositions } from "./positions";
import { canChangeShelfBooks } from "./permissions";
import { toShelf } from "./data";

/**
 * Puts books on manual shelves, idempotently (a book already there is left alone), after checking that
 * each shelf is in the books' library, visible to the caller and open to their role. Returns how many
 * memberships were added and the shelves that were skipped.
 */
export async function attachBooksToShelves(
  db: SupabaseClient,
  args: { userId: string; role: LibraryRole | null; libraryId: string; shelfIds: string[]; bookIds: string[] },
): Promise<{ added: number; skipped: number }> {
  const shelfIds = [...new Set(args.shelfIds)];
  const bookIds = [...new Set(args.bookIds)];
  if (shelfIds.length === 0 || bookIds.length === 0) return { added: 0, skipped: 0 };

  // RLS already hides other people's private shelves; this adds the role and kind checks.
  const { data } = await db
    .from("shelves")
    .select("id, library_id, name, color, icon, visibility, kind, rules, sort, sort_order, created_by, created_at")
    .in("id", shelfIds)
    .eq("library_id", args.libraryId);
  const shelves = (data ?? []).map((r) => toShelf(r as Record<string, unknown>));
  const allowed = shelves.filter((s) => canChangeShelfBooks(args.role, args.userId, s));
  const skipped = shelfIds.length - allowed.length;

  let added = 0;
  for (const shelf of allowed) {
    // Only books not already on the shelf, appended after its last one.
    const { data: existing } = await db.from("shelf_books").select("book_id, position").eq("shelf_id", shelf.id).in("book_id", bookIds);
    const have = new Set((existing ?? []).map((r) => r.book_id as string));
    const fresh = bookIds.filter((id) => !have.has(id));
    if (fresh.length === 0) continue;
    const { data: last } = await db.from("shelf_books").select("position").eq("shelf_id", shelf.id).order("position", { ascending: false }).limit(1);
    const start = Number(last?.[0]?.position ?? 0);
    const rows = appendPositions([{ id: "_", pos: start }], fresh).map((p, i) => ({ shelf_id: shelf.id, book_id: fresh[i], position: p.pos }));
    const { error } = await db.from("shelf_books").upsert(rows, { onConflict: "shelf_id,book_id", ignoreDuplicates: true });
    if (!error) added += rows.length;
  }
  return { added, skipped };
}
