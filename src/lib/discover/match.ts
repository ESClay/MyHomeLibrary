/**
 * Matching a candidate book (a series entry, a recommendation) against what a library already holds.
 * Pure. A book is "in the library" when any of these agree: Hardcover book id, ISBN-13 (the book's own or any copy's),
 * or normalized title + author surname.
 */
import { authorSurname, normalizeTitle } from "@/lib/duplicates";

export type LibraryBookLite = {
  title: string;
  authors: string[];
  isbn13: string | null;
  /** edition_isbn of each copy. */
  copyIsbns: string[];
  hardcoverId: number | null;
};

export type Candidate = {
  title: string;
  authors: string[];
  isbn13s: (string | null | undefined)[];
  hardcoverId: number | null;
};

/** "Dune (Dune, #1)" and "Dune [Illustrated]" compare as "Dune". */
export function cleanTitle(title: string): string {
  return title.replace(/\s*[([][^)\]]*[)\]]\s*$/, "").trim();
}

/** The stable key a pick is known by: normalized title + first author's surname. Feedback is stored under it. */
export function workKey(title: string, authors: string[]): string {
  return `${normalizeTitle(cleanTitle(title))}|${authorSurname(authors[0])}`;
}

export type LibraryIndex = {
  hardcoverIds: Set<number>;
  isbns: Set<string>;
  /** `title|surname` for every author of every book, plus `title|` for books with no author. */
  keys: Set<string>;
  /** Titles of books with no author on file, which match any author. */
  authorless: Set<string>;
};

export function buildLibraryIndex(books: LibraryBookLite[]): LibraryIndex {
  const idx: LibraryIndex = { hardcoverIds: new Set(), isbns: new Set(), keys: new Set(), authorless: new Set() };
  for (const b of books) {
    if (b.hardcoverId) idx.hardcoverIds.add(b.hardcoverId);
    if (b.isbn13) idx.isbns.add(b.isbn13);
    for (const i of b.copyIsbns) if (i) idx.isbns.add(i);
    const title = normalizeTitle(cleanTitle(b.title));
    if (!title) continue;
    const surnames = b.authors.map((a) => authorSurname(a)).filter(Boolean);
    if (surnames.length === 0) idx.authorless.add(title);
    for (const s of surnames) idx.keys.add(`${title}|${s}`);
  }
  return idx;
}

export function inLibrary(idx: LibraryIndex, c: Candidate): boolean {
  if (c.hardcoverId && idx.hardcoverIds.has(c.hardcoverId)) return true;
  for (const i of c.isbn13s) if (i && idx.isbns.has(i)) return true;
  const title = normalizeTitle(cleanTitle(c.title));
  if (!title) return false;
  if (idx.authorless.has(title)) return true;
  const surnames = c.authors.map((a) => authorSurname(a)).filter(Boolean);
  // A candidate with no author on file can only be matched by its title against books that also have none.
  return surnames.some((s) => idx.keys.has(`${title}|${s}`));
}
