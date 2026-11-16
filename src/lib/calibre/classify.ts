/**
 * Sorting catalog rows into New / Already in library / Needs attention, and the actions each allows.
 * The matching is the Phase 2 rule (ISBN-13 across books and copies, then normalized title + first author's surname)
 * plus the Calibre uuid for re-imports, built on maps so 10,000 rows against a large library stay fast.
 */
import { titleAuthorKey } from "@/lib/duplicates";
import type { CalibreRow, ImportAction, RowStatus } from "./types";

/** What the library tells us about a book it already has. */
export type LibraryIndexBook = {
  id: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  calibreUuid: string | null;
  copyIsbns: string[];
};

export type MatchedBy = "uuid" | "isbn" | "title";

export type Classification = {
  status: RowStatus;
  matchedBy: MatchedBy | null;
  match: { id: string; title: string } | null;
  /** Row number of an earlier row in this same file that this one repeats. */
  repeatOf: number | null;
  /** Shown to the person: why the row has this status. */
  reason: string | null;
  defaultAction: ImportAction;
  allowed: ImportAction[];
};

export type LibraryLookup = {
  byUuid: Map<string, LibraryIndexBook>;
  byIsbn: Map<string, LibraryIndexBook>;
  byKey: Map<string, LibraryIndexBook>;
};

export function buildLibraryLookup(books: LibraryIndexBook[]): LibraryLookup {
  const byUuid = new Map<string, LibraryIndexBook>();
  const byIsbn = new Map<string, LibraryIndexBook>();
  const byKey = new Map<string, LibraryIndexBook>();
  for (const b of books) {
    if (b.calibreUuid && !byUuid.has(b.calibreUuid)) byUuid.set(b.calibreUuid, b);
    for (const isbn of [b.isbn13, ...b.copyIsbns]) if (isbn && !byIsbn.has(isbn)) byIsbn.set(isbn, b);
    const key = titleAuthorKey(b.title, b.authors);
    if (key.split("|")[0] && !byKey.has(key)) byKey.set(key, b);
  }
  return { byUuid, byIsbn, byKey };
}

/** The library book a row matches and how: uuid first (a re-import), then ISBN, then title + author. */
export function matchRow(row: Pick<CalibreRow, "calibreUuid" | "isbn13" | "title" | "authors">, lookup: LibraryLookup) {
  if (row.calibreUuid) {
    const b = lookup.byUuid.get(row.calibreUuid);
    if (b) return { book: b, by: "uuid" as const };
  }
  if (row.isbn13) {
    const b = lookup.byIsbn.get(row.isbn13);
    if (b) return { book: b, by: "isbn" as const };
  }
  const key = titleAuthorKey(row.title, row.authors);
  if (key.split("|")[0]) {
    const b = lookup.byKey.get(key);
    if (b) return { book: b, by: "title" as const };
  }
  return null;
}

export function classifyRows(rows: CalibreRow[], books: LibraryIndexBook[]): Classification[] {
  const lookup = buildLibraryLookup(books);
  const seenIsbn = new Map<string, number>();
  const seenKey = new Map<string, number>();

  return rows.map((row): Classification => {
    if (row.error || row.title === "") {
      return {
        status: "attention",
        matchedBy: null,
        match: null,
        repeatOf: null,
        reason: row.error ?? "This row has no title.",
        defaultAction: "skip",
        allowed: ["skip"],
      };
    }

    const hit = matchRow(row, lookup);
    if (hit) {
      const reimport = hit.by === "uuid";
      return {
        status: "existing",
        matchedBy: hit.by,
        match: { id: hit.book.id, title: hit.book.title },
        repeatOf: null,
        reason: reimport
          ? "Already imported from this Calibre library."
          : hit.by === "isbn"
            ? "Same ISBN as a book you already have."
            : "Same title and author as a book you already have.",
        defaultAction: reimport ? "skip" : "copy",
        // A re-imported uuid cannot be added a second time, so "add as a separate book" is only offered for the others.
        allowed: reimport ? ["skip", "copy"] : ["skip", "copy", "add"],
      };
    }

    // Not in the library: is it a repeat of an earlier row in this very file?
    const key = titleAuthorKey(row.title, row.authors);
    const earlier =
      (row.isbn13 ? seenIsbn.get(row.isbn13) : undefined) ?? (key.split("|")[0] ? seenKey.get(key) : undefined);
    if (row.isbn13 && !seenIsbn.has(row.isbn13)) seenIsbn.set(row.isbn13, row.n);
    if (key.split("|")[0] && !seenKey.has(key)) seenKey.set(key, row.n);
    if (earlier !== undefined) {
      return {
        status: "attention",
        matchedBy: null,
        match: null,
        repeatOf: earlier,
        reason: `Looks like row ${earlier} in this file.`,
        defaultAction: "skip",
        allowed: ["skip", "add"],
      };
    }

    return {
      status: "new",
      matchedBy: null,
      match: null,
      repeatOf: null,
      reason: null,
      defaultAction: "add",
      allowed: ["skip", "add"],
    };
  });
}

/** The action to use when the person has not chosen, limited to what the row allows. */
export function effectiveAction(c: Classification, override: ImportAction | undefined): ImportAction {
  return override && c.allowed.includes(override) ? override : c.defaultAction;
}

/** What "select" means for a row: its natural way in. Rows that cannot be imported stay skipped. */
export function includeAction(c: Classification): ImportAction {
  if (c.status === "new") return "add";
  if (c.status === "existing" && c.matchedBy !== "uuid") return "copy";
  return "skip";
}

export type Counts = { total: number; new: number; existing: number; attention: number; toAdd: number; toCopy: number; skipped: number };

export function countRows(classes: Classification[], overrides: ReadonlyMap<number, ImportAction>): Counts {
  const counts: Counts = { total: classes.length, new: 0, existing: 0, attention: 0, toAdd: 0, toCopy: 0, skipped: 0 };
  classes.forEach((c, i) => {
    counts[c.status]++;
    const a = effectiveAction(c, overrides.get(i));
    if (a === "add") counts.toAdd++;
    else if (a === "copy") counts.toCopy++;
    else counts.skipped++;
  });
  return counts;
}
