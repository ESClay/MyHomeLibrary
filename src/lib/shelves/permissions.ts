import type { LibraryRole } from "@/lib/library";
import type { ShelfKind, ShelfVisibility } from "./constants";

export type ShelfAccess = { visibility: ShelfVisibility; createdBy: string | null; kind: ShelfKind };

const isEditor = (role: LibraryRole | null) => role === "owner" || role === "editor";

/** Mirrors the shelves RLS. The database is the authority; the app checks first for friendly errors. */

/** Members see shared shelves; only the creator sees a private one. */
export function canSeeShelf(role: LibraryRole | null, userId: string, s: Pick<ShelfAccess, "visibility" | "createdBy">): boolean {
  return role !== null && (s.visibility === "shared" || s.createdBy === userId);
}

/** Shared shelves need an editor or owner. Private shelves belong to their creator, in any role. */
export function canWriteShelf(role: LibraryRole | null, userId: string, s: Pick<ShelfAccess, "visibility" | "createdBy">): boolean {
  if (role === null) return false;
  return s.visibility === "shared" ? isEditor(role) : s.createdBy === userId;
}

/** Creating: the new shelf's creator is the caller. */
export function canCreateShelf(role: LibraryRole | null, visibility: ShelfVisibility): boolean {
  if (role === null) return false;
  return visibility === "private" ? true : isEditor(role);
}

/** Editing a shelf: allowed to change the old row, and the result must still be writable by the same person. */
export function canEditShelf(
  role: LibraryRole | null,
  userId: string,
  current: Pick<ShelfAccess, "visibility" | "createdBy">,
  nextVisibility: ShelfVisibility,
): boolean {
  return canWriteShelf(role, userId, current) && canWriteShelf(role, userId, { visibility: nextVisibility, createdBy: current.createdBy });
}

/** Hand-made membership exists only on manual shelves. */
export function canChangeShelfBooks(role: LibraryRole | null, userId: string, s: ShelfAccess): boolean {
  return s.kind === "manual" && canWriteShelf(role, userId, s);
}

export function visibleShelves<T extends Pick<ShelfAccess, "visibility" | "createdBy">>(
  role: LibraryRole | null,
  userId: string,
  shelves: T[],
): T[] {
  return shelves.filter((s) => canSeeShelf(role, userId, s));
}
