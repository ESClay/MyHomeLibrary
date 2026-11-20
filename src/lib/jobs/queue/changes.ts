import { CHANGE_FIELDS, type BookChange, type ChangeField, type FieldValues } from "./types";

/**
 * Folds a later change to the same book into the earlier one: the first `before` of each field is kept (what the book
 * really was), the last `after` wins. A field that ends up where it started drops out, and so does a book with nothing
 * left to undo (returned as before = after = {}).
 */
export function mergeChange(prev: BookChange | undefined, next: BookChange): BookChange {
  if (!prev) return next;
  const before: FieldValues = { ...next.before, ...prev.before };
  const after: FieldValues = { ...prev.after, ...next.after };
  for (const f of CHANGE_FIELDS) {
    if (f in before && f in after && before[f] === after[f]) {
      delete before[f];
      delete after[f];
    }
  }
  return { bookId: next.bookId, before, after };
}

export type UndoPlan = {
  /** Fields to write back (their `before` values). */
  restore: FieldValues;
  /** Fields left alone because the book no longer holds what the job wrote. */
  edited: ChangeField[];
};

/**
 * The undo rule: put `before` back for a field only while the book still holds the job's `after`. A field edited since
 * (or changed by a later job) is never overwritten.
 */
export function planUndo(change: Pick<BookChange, "before" | "after">, current: Record<string, unknown>): UndoPlan {
  const restore: FieldValues = {};
  const edited: ChangeField[] = [];
  for (const f of CHANGE_FIELDS) {
    if (!(f in change.after)) continue;
    const now = current[f] ?? null;
    const wrote = change.after[f] ?? null;
    if (now === wrote || (now !== null && wrote !== null && Number(now) === Number(wrote) && typeof now !== "string" && typeof wrote !== "string")) {
      restore[f] = change.before[f] ?? null;
    } else {
      edited.push(f);
    }
  }
  return { restore, edited };
}

/** Where a recorded change stands now: untouched, partly or wholly edited since, or already undone. */
export function changeState(change: Pick<BookChange, "before" | "after"> & { undoneAt?: string | null }, current: Record<string, unknown>): "applied" | "edited" | "undone" {
  if (change.undoneAt) return "undone";
  return planUndo(change, current).edited.length === 0 ? "applied" : "edited";
}
